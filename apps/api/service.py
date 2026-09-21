from dataclasses import dataclass, replace
import os
import time
import logging
import math
from uuid import uuid4

import numpy as np

from engine.burn import (days_left, freshness_fraction, update_budget, in_model_range,
                        current_aging_rate, AGING_RATE_REFERENCE_Q10, PROJECTION_TEMPERATURE_C)
from engine.conditioning import condition_samples, gas_baseline_samples
from engine.fusion import FusionUncertainty, fuse, load_fusion_uncertainty
from engine.gas import fit_gas_baseline, gas_anomaly
from engine.config import gas_baseline_config
from engine.models import TelemetrySample
from engine.profiles import load_profiles

from .store import AlertRecord, AppStore, ItemRecord

logger = logging.getLogger(__name__)
STALE_AFTER_SECONDS = 180


@dataclass(frozen=True)
class StorageOptimization:
    """A transparent what-if projection based only on Track A.

    Humidity and experimental gas/color signals are deliberately excluded:
    they do not extend the temperature budget in the current model.
    """

    target_temperature_c: float
    current_temperature_c: float | None
    projected_days_at_current_temperature: float | None
    projected_days_at_target_temperature: float | None
    potential_days_preserved: float | None
    temperature_action: str
    humidity_affects_days_left: bool = False


@dataclass(frozen=True)
class ItemState:
    id: str
    name: str
    profile_id: str
    created_at: float
    t_eff: float
    opened: bool
    freshness_fraction: float
    track_a_days_left: float
    days_left: float
    confidence: str
    status: str
    placeholder_profile: bool
    advice: str
    color_score: float | None
    gas_anomaly: float | None
    brand: str | None
    printed_date: str | None
    package_size: str | None
    lot_code: str | None
    has_photo: bool
    data_gap_hours: float
    fusion_uncertainty: FusionUncertainty
    t_eff_incomplete: bool
    history_message: str | None
    outside_model_range: bool
    model_message: str | None
    profile_name: str
    d0_source: str
    q10_source: str
    projection_temperature_c: float
    estimate_message: str | None
    # Current conditions, not a prediction: how fast this item is aging right
    # now versus 4C. None when the reading is missing, stale or out of range.
    aging_rate: float | None
    storage_optimization: StorageOptimization


@dataclass(frozen=True)
class TelemetryState:
    timestamp: float | None
    temperature: float | None
    humidity: float | None
    gas_resistance: float | None
    gas_anomaly: float | None
    iaq_accuracy: int | None
    baseline_residual_sigma: float | None
    reading_age_seconds: float | None
    connected: bool
    # Fridge-level aging rate at the reference Q10; None when unavailable.
    aging_rate: float | None
    aging_rate_reference_q10: float


@dataclass(frozen=True)
class AppState:
    telemetry: TelemetryState
    items: list[ItemState]
    alerts: list[AlertRecord]
    active_scenario: str | None
    telemetry_paused: bool


class FreshnessService:
    def __init__(
        self,
        store: AppStore | None = None,
        # Off by default: the app must never invent items the user did not add.
        seed_hero_items: bool = False,
        storage_path: str | None = None,
        calibration_path: str | None = None,
        experimental_fusion: bool | None = None,
    ):
        self.store = store or AppStore(storage_path=storage_path)
        self.profiles = load_profiles()
        self.experimental_fusion = (os.getenv("ENABLE_EXPERIMENTAL_FUSION", "false").lower() == "true"
                                    if experimental_fusion is None else experimental_fusion)
        self.fusion_uncertainty = (replace(load_fusion_uncertainty(calibration_path), used_for_estimate=True)
            if self.experimental_fusion else FusionUncertainty(sigma_b_reason="unused_gas_fusion_disabled"))
        if seed_hero_items and not self.store.items:
            for profile_id, name in (
                ("dairy", "Milk"),
                ("poultry", "Raw chicken breast"),
                ("leafy_greens", "Spinach"),
            ):
                self.add_item(profile_id, name)

    def add_item(
        self,
        profile_id: str,
        name: str | None = None,
        *,
        brand: str | None = None,
        printed_date: str | None = None,
        package_size: str | None = None,
        lot_code: str | None = None,
        photo: bytes | None = None,
    ) -> ItemState:
        profile = self.profiles.get(profile_id)
        if profile is None:
            raise ValueError(f"Unknown food profile: {profile_id}")
        item = ItemRecord(
            id=uuid4().hex[:12],
            profile_id=profile_id,
            name=name or profile.name,
            active_d0_days=profile.d0_days,
            created_at=time.time(),
            brand=brand,
            printed_date=printed_date,
            package_size=package_size,
            lot_code=lot_code,
            photo=photo,
        )
        self.store.items[item.id] = item
        self.store.persist()
        return self._item_state(item)

    def get_item(self, item_id: str) -> ItemState:
        return self._item_state(self._get_item(item_id))

    def get_item_photo(self, item_id: str) -> bytes:
        photo = self._get_item(item_id).photo
        if photo is None:
            raise KeyError(f"Item {item_id} has no photo")
        return photo

    def stash_scan_photo(self, photo: bytes) -> str:
        """Hold a scan's thumbnail until the confirm step creates its item."""
        scan_id = uuid4().hex[:12]
        self.store.stash_scan_photo(scan_id, photo)
        return scan_id

    def take_scan_photo(self, scan_id: str | None) -> bytes | None:
        """Claim a stashed thumbnail. A stale or unknown id simply means no photo."""
        if scan_id is None:
            return None
        return self.store.scan_photos.pop(scan_id, None)

    def rename_item(self, item_id: str, name: str) -> ItemState:
        name = name.strip()
        if not name:
            raise ValueError("name must not be empty")
        item = self._get_item(item_id)
        item.name = name
        self.store.persist()
        return self._item_state(item)

    def set_category(self, item_id: str, profile_id: str) -> ItemState:
        profile = self.profiles.get(profile_id)
        if profile is None:
            raise ValueError(f"Unknown food profile: {profile_id}")
        item = self._get_item(item_id)
        if item.profile_id == profile_id:
            return self._item_state(item)
        history = self.store.telemetry_history
        if item.t_eff > 0 and (not history or history[0].timestamp > item.created_at):
            raise ValueError("Cannot change category: stored temperature history does not cover tracking start")
        before_opened = 0.0
        recomputed = 0.0
        for a, b in zip(history, history[1:]):
            if b.timestamp <= item.created_at:
                continue
            if not in_model_range(a.temperature) or not in_model_range(b.temperature):
                item.outside_model_range = True
                item.t_eff_incomplete = True
                continue
            start = max(a.timestamp, item.created_at)
            temperature = a.temperature if b.timestamp - a.timestamp > 120 else b.temperature
            if item.opened and item.opened_at is not None:
                hours = max(0.0, min(b.timestamp, item.opened_at) - start) / 3600
                before_opened = update_budget(before_opened, temperature, hours, profile.q10)
                start = max(start, item.opened_at)
            recomputed = update_budget(recomputed, temperature,
                                       max(0.0, b.timestamp - start) / 3600, profile.q10)
        item.profile_id = profile_id
        item.t_eff = recomputed
        item.active_d0_days = (min(profile.opened_d0_days, max(0.0, profile.d0_days - before_opened))
                              if item.opened else profile.d0_days)
        self._refresh_alerts()
        self.store.persist()
        return self._item_state(item)

    def ingest(self, sample: TelemetrySample) -> AppState:
        previous = self.store.latest_telemetry
        if not math.isfinite(sample.timestamp) or (previous and sample.timestamp <= previous.timestamp):
            logger.warning("Dropped non-increasing or invalid telemetry timestamp: %s", sample.timestamp)
            return self.snapshot()
        dt_hours = 0.0
        integration_temperature = sample.temperature
        if previous is not None:
            dt_hours = max(0.0, sample.timestamp - previous.timestamp) / 3600.0
            if dt_hours > 2.0 / 60.0:
                self.store.data_gap_hours += dt_hours
                integration_temperature = previous.temperature

        for item in self.store.items.values():
            profile = self.profiles[item.profile_id]
            if (not in_model_range(sample.temperature)
                    or (previous and not in_model_range(previous.temperature))):
                item.outside_model_range = True
                item.t_eff_incomplete = True
            else:
                item.t_eff = update_budget(item.t_eff, integration_temperature, dt_hours, profile.q10)

        self.store.append_telemetry(sample)
        self.store.telemetry_paused = False
        if self.store.gas_baseline is None:
            self.fit_gas_baseline_from_history()
        self._refresh_alerts()
        state = self.snapshot()
        self.store.persist()
        return state

    def mark_opened(self, item_id: str) -> ItemState:
        item = self._get_item(item_id)
        profile = self.profiles[item.profile_id]
        remaining_reference_days = max(0.0, item.active_d0_days - item.t_eff)
        item.active_d0_days = min(remaining_reference_days, profile.opened_d0_days)
        item.t_eff = 0.0
        item.opened = True
        item.opened_at = time.time()
        self._refresh_alerts()
        self.store.persist()
        return self._item_state(item)

    def restore_complete_history(self, samples: list[TelemetrySample]) -> None:
        """Repair flagged items only after a replay covers their entire tracked span."""
        if not samples:
            return
        ordered = sorted(samples, key=lambda sample: sample.timestamp)
        latest = self.store.latest_telemetry
        for item in self.store.items.values():
            if (not item.t_eff_incomplete or ordered[0].timestamp > item.created_at
                    or item.outside_model_range
                    or ordered[-1].timestamp < item.created_at
                    or (item.opened and item.opened_at is None)
                    or (latest and ordered[-1].timestamp < latest.timestamp)):
                continue
            intervals = [(a, b) for a, b in zip(ordered, ordered[1:])
                         if b.timestamp > item.created_at]
            # Missing internal intervals are not full coverage either.
            if any(b.timestamp - a.timestamp > 120 or not in_model_range(a.temperature)
                   or not in_model_range(b.temperature) for a, b in intervals):
                continue
            profile = self.profiles[item.profile_id]
            before_opened = 0.0
            recovered = 0.0
            for a, b in intervals:
                start = max(a.timestamp, item.created_at)
                if item.opened and item.opened_at is not None:
                    before_hours = max(0.0, min(b.timestamp, item.opened_at) - start) / 3600
                    before_opened = update_budget(before_opened, b.temperature, before_hours, profile.q10)
                    start = max(start, item.opened_at)
                hours = max(0.0, b.timestamp - start) / 3600
                recovered = update_budget(recovered, b.temperature, hours, profile.q10)
            # Recover omitted damage without making an existing estimate fresher.
            item.t_eff = max(item.t_eff, recovered)
            if item.opened:
                item.active_d0_days = min(item.active_d0_days, profile.opened_d0_days,
                                          max(0.0, profile.d0_days - before_opened))
            item.t_eff_incomplete = False
        self._refresh_alerts()
        self.store.persist()

    def remove_item(self, item_id: str) -> None:
        """Delete an item. Alerts are keyed by item id, so they must be rebuilt."""
        self._get_item(item_id)
        del self.store.items[item_id]
        self._refresh_alerts()
        self.store.persist()

    def set_label_score(self, item_id: str, score: float) -> ItemState:
        if not 0.0 <= score <= 1.0:
            raise ValueError("label score must be between 0 and 1")
        item = self._get_item(item_id)
        item.color_score = float(score)
        self._refresh_alerts()
        self.store.persist()
        return self._item_state(item)


    def fit_gas_baseline_from_history(self, min_samples: int | None = None):
        config = gas_baseline_config()
        min_samples = config.min_samples if min_samples is None else min_samples
        if min_samples <= 0:
            raise ValueError("min_samples must be positive")
        with_gas = [
            s for s in self.store.telemetry_history
            if s.gas_resistance is not None and (s.iaq_accuracy is None or s.iaq_accuracy >= 3)
        ]
        conditioned = condition_samples(with_gas)
        eligible = gas_baseline_samples(conditioned)
        if len(eligible) < min_samples or eligible[-1].timestamp - eligible[0].timestamp < config.min_span_hours * 3600:
            self.store.last_gas_baseline_sample_count = len(eligible)
            return None
        selected = eligible
        baseline = fit_gas_baseline(
            np.asarray([sample.temperature for sample in selected], dtype=float),
            np.asarray([sample.humidity for sample in selected], dtype=float),
            np.asarray([sample.gas_resistance for sample in selected], dtype=float),
        )
        self.store.gas_baseline = baseline
        self.store.last_gas_baseline_sample_count = len(selected)
        self.store.persist()
        return baseline

    def gas_diagnostics(self) -> dict[str, object]:
        config = gas_baseline_config()
        samples = [s for s in self.store.telemetry_history if s.gas_resistance is not None]
        if not samples:
            return {"sample_count": 0, "time_span_hours": 0.0, "std_temperature": 0.0, "std_humidity": 0.0, "condition_number": None, "gates": {"samples": False, "span": False, "variation": False, "condition": False}}
        T = np.asarray([s.temperature for s in samples]); RH = np.asarray([s.humidity for s in samples])
        condition = float(np.linalg.cond(np.column_stack([np.ones(len(T)), T, RH, T * RH])))
        span = (samples[-1].timestamp - samples[0].timestamp) / 3600.0
        return {"sample_count": len(samples), "time_span_hours": span, "std_temperature": float(np.std(T)), "std_humidity": float(np.std(RH)), "condition_number": condition, "gates": {"samples": len(samples) >= config.min_samples, "span": span >= config.min_span_hours, "variation": float(np.std(RH)) >= config.min_rh_std and float(np.std(T)) >= config.min_temperature_std, "condition": condition <= config.max_condition_number}}

    def snapshot(self) -> AppState:
        gas_score = self._latest_gas_anomaly()
        latest = self.store.latest_telemetry
        age = max(0.0, time.time() - latest.timestamp) if latest else None
        connected = age is not None and age <= STALE_AFTER_SECONDS
        telemetry = TelemetryState(
            timestamp=latest.timestamp if latest else None,
            temperature=latest.temperature if latest else None,
            humidity=latest.humidity if latest else None,
            gas_resistance=latest.gas_resistance if latest else None,
            gas_anomaly=gas_score,
            iaq_accuracy=latest.iaq_accuracy if latest else None,
            baseline_residual_sigma=(self.store.gas_baseline.baseline_residual_sigma
                                     if self.store.gas_baseline else None),
            reading_age_seconds=age,
            connected=connected,
            aging_rate=current_aging_rate(
                latest.temperature if latest is not None and connected else None,
                AGING_RATE_REFERENCE_Q10),
            aging_rate_reference_q10=AGING_RATE_REFERENCE_Q10,
        )
        items = sorted(
            (self._item_state(item, gas_score) for item in self.store.items.values()),
            key=lambda state: state.days_left,
        )
        return AppState(
            telemetry=telemetry,
            items=items,
            alerts=list(self.store.alerts),
            active_scenario=self.store.active_scenario,
            telemetry_paused=self.store.telemetry_paused,
        )

    def reset_demo_state(self) -> AppState:
        self.store.telemetry_history.clear()
        self.store.latest_telemetry = None
        self.store.gas_baseline = None
        self.store.last_gas_baseline_sample_count = 0
        self.store.alerts.clear()
        self.store.active_scenario = None
        self.store.telemetry_paused = False
        for item in self.store.items.values():
            profile = self.profiles[item.profile_id]
            item.active_d0_days = profile.d0_days
            item.t_eff = 0.0
            item.opened = False
            item.color_score = None
            item.opened_at = None
            item.outside_model_range = False
            item.t_eff_incomplete = False
        self.store.persist()
        return self.snapshot()

    def _get_item(self, item_id: str) -> ItemRecord:
        try:
            return self.store.items[item_id]
        except KeyError as exc:
            raise KeyError(f"Unknown item id: {item_id}") from exc

    def _latest_gas_anomaly(self) -> float | None:
        latest = self.store.latest_telemetry
        baseline = self.store.gas_baseline
        if (
            latest is None
            or baseline is None
            or latest.gas_resistance is None
            or (latest.iaq_accuracy is not None and latest.iaq_accuracy < 3)
        ):
            return None
        return float(
            gas_anomaly(
                np.array([latest.temperature]),
                np.array([latest.humidity]),
                np.array([latest.gas_resistance]),
                baseline,
            )[0]
        )

    def _track_a(self, item: ItemRecord, temperature_c: float = PROJECTION_TEMPERATURE_C) -> tuple[float, float]:
        profile = self.profiles[item.profile_id]
        if item.active_d0_days <= 0:
            return 0.0, 0.0
        f_a = freshness_fraction(item.t_eff, item.active_d0_days)
        days_a = days_left(item.t_eff, item.active_d0_days, temperature_c, profile.q10)
        return f_a, days_a

    def _storage_optimization(
        self,
        item: ItemRecord,
        current_temperature: float | None,
        reading_available: bool,
    ) -> StorageOptimization:
        """Compare continued storage now with the model's 4C reference.

        This is a prospective scenario, not a promise and not a way to undo
        temperature exposure that has already accrued.
        """
        profile = self.profiles[item.profile_id]
        target_days = days_left(
            item.t_eff, item.active_d0_days, PROJECTION_TEMPERATURE_C, profile.q10)

        if item.outside_model_range or not reading_available or current_temperature is None:
            return StorageOptimization(
                target_temperature_c=PROJECTION_TEMPERATURE_C,
                current_temperature_c=None,
                projected_days_at_current_temperature=None,
                projected_days_at_target_temperature=None if item.outside_model_range else target_days,
                potential_days_preserved=None,
                temperature_action="unavailable",
            )

        current_days = days_left(
            item.t_eff, item.active_d0_days, current_temperature, profile.q10)
        if current_temperature > PROJECTION_TEMPERATURE_C:
            action = "cool_to_target"
        elif current_temperature < 0.0:
            action = "check_freezing"
        else:
            action = "maintain"

        return StorageOptimization(
            target_temperature_c=PROJECTION_TEMPERATURE_C,
            current_temperature_c=current_temperature,
            projected_days_at_current_temperature=current_days,
            projected_days_at_target_temperature=target_days,
            potential_days_preserved=max(0.0, target_days - current_days),
            temperature_action=action,
        )

    def _item_state(self, item: ItemRecord, gas_score: float | None = None) -> ItemState:
        profile = self.profiles[item.profile_id]
        latest = self.store.latest_telemetry
        stale = latest is None or time.time() - latest.timestamp > STALE_AFTER_SECONDS
        # Primary days-left projects at the live temperature; 4C only as a fallback.
        live = latest is not None and not stale and in_model_range(latest.temperature)
        f_a, days_a = self._track_a(item, latest.temperature if live else PROJECTION_TEMPERATURE_C)
        if gas_score is None:
            gas_score = self._latest_gas_anomaly()
        sigma_b = self.fusion_uncertainty.sigma_b
        fused = fuse(days_a, f_a, gas_score, item.color_score, sigma_b=sigma_b,
                     experimental_enabled=self.experimental_fusion)
        confidence = "med" if self.store.data_gap_hours > 0 and fused.confidence == "high" else fused.confidence
        if item.t_eff_incomplete:
            confidence = "low"
        if stale or self.store.data_gap_hours > 0:
            confidence = "low"
        item.state = fused.status
        aging_rate = current_aging_rate(
            latest.temperature if latest is not None and not stale else None, profile.q10)
        return ItemState(
            id=item.id,
            name=item.name,
            profile_id=item.profile_id,
            created_at=item.created_at,
            t_eff=item.t_eff,
            opened=item.opened,
            freshness_fraction=f_a,
            track_a_days_left=days_a,
            days_left=fused.days_left,
            confidence=confidence,
            status=fused.status,
            placeholder_profile=profile.placeholder,
            advice=profile.advice,
            color_score=item.color_score,
            gas_anomaly=gas_score if self.experimental_fusion else None,
            brand=item.brand,
            printed_date=item.printed_date,
            package_size=item.package_size,
            lot_code=item.lot_code,
            has_photo=item.photo is not None,
            data_gap_hours=self.store.data_gap_hours,
            fusion_uncertainty=self.fusion_uncertainty,
            t_eff_incomplete=item.t_eff_incomplete,
            history_message=("partial history — estimate may be optimistic"
                             if item.t_eff_incomplete else None),
            outside_model_range=item.outside_model_range,
            model_message="outside modelled range" if item.outside_model_range else None,
            profile_name=profile.name,
            d0_source=profile.source,
            q10_source=profile.q10_source or "placeholder",
            projection_temperature_c=PROJECTION_TEMPERATURE_C,
            # A stale reading must not be presented as the current rate.
            aging_rate=aging_rate,
            storage_optimization=self._storage_optimization(
                item,
                latest.temperature if latest is not None else None,
                latest is not None and not stale and in_model_range(latest.temperature),
            ),
            estimate_message=("Readings missing or stale — estimate may be optimistic" if stale
                else f"data gap: {self.store.data_gap_hours:.0f}h — estimate may be optimistic"
                if self.store.data_gap_hours > 0 else None),
        )

    def _refresh_alerts(self) -> None:
        alerts: list[AlertRecord] = []
        latest = self.store.latest_telemetry
        if latest is not None and latest.temperature > 8.0:
            alerts.append(
                AlertRecord(
                    "warm_fridge",
                    "Temperature is elevated; freshness is burning faster.",
                    "warning",
                )
            )
        gas_score = self._latest_gas_anomaly()
        for item in self.store.items.values():
            state = self._item_state(item, gas_score)
            if state.days_left <= 1.0:
                alerts.append(
                    AlertRecord(
                        f"critical_{item.id}",
                        f"{item.name}: use soon; freshness budget is nearly exhausted.",
                        "warning",
                    )
                )
        self.store.alerts = alerts

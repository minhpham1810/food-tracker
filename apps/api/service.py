from dataclasses import dataclass
import time
from uuid import uuid4

import numpy as np

from engine.burn import days_left, freshness_fraction, update_budget
from engine.conditioning import condition_samples, gas_baseline_samples
from engine.fusion import fuse
from engine.gas import fit_gas_baseline, gas_anomaly
from engine.models import TelemetrySample
from engine.profiles import load_profiles

from .store import AlertRecord, AppStore, ItemRecord


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


@dataclass(frozen=True)
class TelemetryState:
    timestamp: float | None
    temperature: float | None
    humidity: float | None
    gas_resistance: float | None
    gas_anomaly: float | None


@dataclass(frozen=True)
class AppState:
    telemetry: TelemetryState
    items: list[ItemState]
    alerts: list[AlertRecord]
    active_scenario: str | None
    telemetry_paused: bool


class FreshnessService:
    def __init__(self, store: AppStore | None = None):
        self.store = store or AppStore()
        self.profiles = load_profiles()

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
        return self._item_state(item)

    def set_category(self, item_id: str, profile_id: str) -> ItemState:
        profile = self.profiles.get(profile_id)
        if profile is None:
            raise ValueError(f"Unknown food profile: {profile_id}")
        item = self._get_item(item_id)
        item.profile_id = profile_id
        item.active_d0_days = profile.opened_d0_days if item.opened else profile.d0_days
        self._refresh_alerts()
        return self._item_state(item)

    def ingest(self, sample: TelemetrySample) -> AppState:
        previous = self.store.latest_telemetry
        dt_hours = 0.0
        if previous is not None:
            dt_hours = max(0.0, sample.timestamp - previous.timestamp) / 3600.0

        for item in self.store.items.values():
            profile = self.profiles[item.profile_id]
            item.t_eff = update_budget(item.t_eff, sample.temperature, dt_hours, profile.q10)

        self.store.append_telemetry(sample)
        self.store.telemetry_paused = False
        if self.store.gas_baseline is None:
            self.fit_gas_baseline_from_history(min_samples=20)
        self._refresh_alerts()
        return self.snapshot()

    def mark_opened(self, item_id: str) -> ItemState:
        item = self._get_item(item_id)
        profile = self.profiles[item.profile_id]
        remaining_reference_days = max(0.0, item.active_d0_days - item.t_eff)
        item.active_d0_days = min(remaining_reference_days, profile.opened_d0_days)
        item.t_eff = 0.0
        item.opened = True
        self._refresh_alerts()
        return self._item_state(item)

    def remove_item(self, item_id: str) -> None:
        """Delete an item. Alerts are keyed by item id, so they must be rebuilt."""
        self._get_item(item_id)
        del self.store.items[item_id]
        self._refresh_alerts()

    def set_label_score(self, item_id: str, score: float) -> ItemState:
        if not 0.0 <= score <= 1.0:
            raise ValueError("label score must be between 0 and 1")
        item = self._get_item(item_id)
        item.color_score = float(score)
        self._refresh_alerts()
        return self._item_state(item)


    def fit_gas_baseline_from_history(self, min_samples: int = 20):
        if min_samples <= 0:
            raise ValueError("min_samples must be positive")
        with_gas = [s for s in self.store.telemetry_history if s.gas_resistance is not None]
        conditioned = condition_samples(with_gas)
        eligible = gas_baseline_samples(conditioned)
        if len(eligible) < min_samples:
            self.store.last_gas_baseline_sample_count = len(eligible)
            return None
        selected = eligible[:min_samples]
        baseline = fit_gas_baseline(
            np.asarray([sample.temperature for sample in selected], dtype=float),
            np.asarray([sample.humidity for sample in selected], dtype=float),
            np.asarray([sample.gas_resistance for sample in selected], dtype=float),
        )
        self.store.gas_baseline = baseline
        self.store.last_gas_baseline_sample_count = len(selected)
        return baseline

    def snapshot(self) -> AppState:
        gas_score = self._latest_gas_anomaly()
        latest = self.store.latest_telemetry
        telemetry = TelemetryState(
            timestamp=latest.timestamp if latest else None,
            temperature=latest.temperature if latest else None,
            humidity=latest.humidity if latest else None,
            gas_resistance=latest.gas_resistance if latest else None,
            gas_anomaly=gas_score,
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
        return self.snapshot()

    def _get_item(self, item_id: str) -> ItemRecord:
        try:
            return self.store.items[item_id]
        except KeyError as exc:
            raise KeyError(f"Unknown item id: {item_id}") from exc

    def _latest_gas_anomaly(self) -> float | None:
        latest = self.store.latest_telemetry
        baseline = self.store.gas_baseline
        if latest is None or baseline is None or latest.gas_resistance is None:
            return None
        return float(
            gas_anomaly(
                np.array([latest.temperature]),
                np.array([latest.humidity]),
                np.array([latest.gas_resistance]),
                baseline,
            )[0]
        )

    def _track_a(self, item: ItemRecord) -> tuple[float, float]:
        profile = self.profiles[item.profile_id]
        if item.active_d0_days <= 0:
            return 0.0, 0.0
        current_temp = self.store.latest_telemetry.temperature if self.store.latest_telemetry else 4.0
        f_a = freshness_fraction(item.t_eff, item.active_d0_days)
        days_a = days_left(item.t_eff, item.active_d0_days, current_temp, profile.q10)
        return f_a, days_a

    def _item_state(self, item: ItemRecord, gas_score: float | None = None) -> ItemState:
        profile = self.profiles[item.profile_id]
        f_a, days_a = self._track_a(item)
        if gas_score is None:
            gas_score = self._latest_gas_anomaly()
        fused = fuse(days_a, f_a, gas_score, item.color_score)
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
            confidence=fused.confidence,
            status=fused.status,
            placeholder_profile=profile.placeholder,
            advice=profile.advice,
            color_score=item.color_score,
            gas_anomaly=gas_score,
            brand=item.brand,
            printed_date=item.printed_date,
            package_size=item.package_size,
            lot_code=item.lot_code,
            has_photo=item.photo is not None,
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

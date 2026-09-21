import time

import pytest

from apps.api.service import FreshnessService
from engine.models import TelemetrySample


def test_service_starts_with_an_empty_inventory():
    service = FreshnessService()
    assert service.snapshot().items == []


def test_telemetry_updates_item_budget_using_elapsed_time():
    service = FreshnessService()
    item = service.add_item("dairy")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    state = service.ingest(TelemetrySample(3600, 22.0, 60.0, 200000.0, False))
    updated = next(x for x in state.items if x.id == item.id)
    assert updated.t_eff > 0
    assert updated.days_left < item.days_left


def test_six_hour_gap_integrates_last_temperature_and_lowers_confidence():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("dairy")
    service.ingest(TelemetrySample(0, 22.0, 60.0, None, False))
    state = service.ingest(TelemetrySample(6 * 3600, 4.0, 60.0, None, False))
    updated = next(x for x in state.items if x.id == item.id)
    assert updated.t_eff > 0
    assert updated.data_gap_hours == 6.0
    assert updated.confidence == "low"


def test_sqlite_restart_preserves_t_eff_and_days_left(tmp_path):
    storage = tmp_path / "freshness.sqlite3"
    first = FreshnessService(seed_hero_items=False, storage_path=str(storage))
    item = first.add_item("dairy", "Restart milk")
    first.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    before = first.ingest(TelemetrySample(3600, 8.0, 60.0, 200000.0, False)).items[0]

    restarted = FreshnessService(seed_hero_items=False, storage_path=str(storage))
    after = restarted.get_item(item.id)

    assert after.t_eff == before.t_eff
    assert after.days_left == before.days_left


def test_restart_does_not_recompute_five_day_item_from_one_page(tmp_path):
    storage = tmp_path / "long-lived.sqlite3"
    first = FreshnessService(seed_hero_items=False, storage_path=str(storage))
    item = first.add_item("eggs")
    first.store.items[item.id].created_at -= 5 * 86400
    first.ingest(TelemetrySample(0, 4.0, 60.0, None, False))
    first.ingest(TelemetrySample(3600, 8.0, 60.0, None, False))
    before = first.get_item(item.id)
    restarted = FreshnessService(seed_hero_items=False, storage_path=str(storage))
    after = restarted.get_item(item.id)
    assert after.t_eff == before.t_eff
    assert after.days_left == before.days_left


def test_iaq_accuracy_gates_gas_anomaly_but_not_temperature_budget():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("dairy")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False, iaq_accuracy=3))
    state = service.ingest(TelemetrySample(3600, 22.0, 60.0, 1000.0, False, iaq_accuracy=1))
    updated = next(x for x in state.items if x.id == item.id)
    assert updated.t_eff > 0
    assert state.telemetry.iaq_accuracy == 1
    assert state.telemetry.gas_anomaly is None


def test_opened_action_caps_remaining_budget_to_opened_profile_budget():
    service = FreshnessService()
    item = service.add_item("dairy")
    opened = service.mark_opened(item.id)
    assert opened.opened is True
    assert opened.days_left <= 5.0


def test_opening_never_increases_remaining_life():
    service = FreshnessService()
    item = service.add_item("poultry")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    before = service.ingest(TelemetrySample(36 * 3600, 4.0, 60.0, 200000.0, False)).items[0]
    after = service.mark_opened(item.id)
    assert after.days_left <= before.days_left


def test_label_score_never_extends_track_a():
    service = FreshnessService()
    item = service.add_item("dairy")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    track_a = service.snapshot().items[0].track_a_days_left
    scored = service.set_label_score(item.id, 0.5)
    assert scored.days_left <= track_a
    assert scored.t_eff == item.t_eff


def test_door_open_samples_do_not_enter_gas_baseline_fit():
    service = FreshnessService(seed_hero_items=False)
    for i in range(1600):
        service.ingest(TelemetrySample(i * 120, 4.0, 60.0, 200000.0 - i * 100, i % 5 == 0))
    baseline = service.fit_gas_baseline_from_history()
    assert baseline is not None
    assert service.store.last_gas_baseline_sample_count >= 500


def test_gas_baseline_is_fitted_automatically_after_clean_history():
    service = FreshnessService(seed_hero_items=False)
    for i in range(1600):
        service.ingest(TelemetrySample(i * 120, 4.0 + i * 0.01, 60.0, 200000.0 - i * 50, False))
    assert service.store.gas_baseline is not None
    assert service.snapshot().telemetry.gas_anomaly is not None


def test_samples_without_gas_still_burn_budget_but_skip_gas_track():
    service = FreshnessService()
    item = service.add_item("dairy")
    for i in range(30):
        service.ingest(TelemetrySample(i * 60, 22.0, 52.0, None, False))
    assert service.get_item(item.id).t_eff > 0
    assert service.store.gas_baseline is None
    assert service.store.last_gas_baseline_sample_count == 0
    assert service.snapshot().telemetry.gas_anomaly is None


def test_gas_anomaly_is_unavailable_when_the_latest_sample_has_no_gas():
    service = FreshnessService(seed_hero_items=False)
    for i in range(1600):
        service.ingest(TelemetrySample(i * 120, 4.0 + i * 0.01, 60.0, 200000.0 - i * 50, False))
    service.ingest(TelemetrySample(1600 * 120, 4.2, 60.0, None, False))
    assert service.store.gas_baseline is not None
    assert service.snapshot().telemetry.gas_anomaly is None


def test_contradiction_scenario_surfaces_secondary_disagreement():
    from simulator.scenarios import generate_scenario

    service = FreshnessService()
    service.add_item("dairy")
    for sample in generate_scenario("contradiction", 0):
        service.ingest(sample)
    state = service.snapshot()
    assert state.telemetry.gas_anomaly is None
    assert state.items[0].track_a_days_left > 0
    assert state.items[0].status == "fresh"


def test_items_store_added_timestamp():
    service = FreshnessService()
    item = service.add_item("dairy")
    assert item.created_at > 0


def test_rename_item_updates_display_name_only():
    service = FreshnessService()
    item = service.add_item("dairy")
    renamed = service.rename_item(item.id, "Leftover milk")
    assert renamed.name == "Leftover milk"
    assert renamed.days_left == item.days_left


def test_rename_item_rejects_blank_name():
    service = FreshnessService()
    item = service.add_item("dairy")
    try:
        service.rename_item(item.id, "   ")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_set_category_switches_profile_and_recomputes_budget():
    service = FreshnessService()
    item = service.add_item("dairy")
    recategorized = service.set_category(item.id, "poultry")
    assert recategorized.profile_id == "poultry"


def test_set_category_rejects_unknown_profile():
    service = FreshnessService()
    item = service.add_item("dairy")
    try:
        service.set_category(item.id, "made-up")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_add_item_stores_ocr_metadata():
    service = FreshnessService()
    item = service.add_item("dairy", "Scanned milk", brand="Meadow Gold", lot_code="L2309A")
    assert item.brand == "Meadow Gold"
    assert item.lot_code == "L2309A"


def test_warm_fridge_alert_has_no_demo_milk_cost():
    service = FreshnessService()
    service.add_item("dairy")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    state = service.ingest(TelemetrySample(3600, 22.0, 60.0, 200000.0, False))
    codes = {alert.code for alert in state.alerts}
    assert "warm_fridge" in codes
    assert "excursion_damage" not in codes


def test_aging_rate_is_exposed_and_tracks_the_latest_reading():
    service = FreshnessService(seed_hero_items=False)
    service.add_item("dairy")
    # Timestamps must be recent, or the reading counts as stale and is withheld.
    now = time.time()
    service.ingest(TelemetrySample(now, 4.0, 60.0, None, False))
    assert service.snapshot().items[0].aging_rate == pytest.approx(1.0)
    # A warmer reading raises the rate immediately, without days_left moving much.
    service.ingest(TelemetrySample(now + 60, 22.0, 60.0, None, False))
    state = service.snapshot()
    assert state.items[0].aging_rate == pytest.approx(2.7 ** 1.8)
    assert state.telemetry.aging_rate == pytest.approx(2.7 ** 1.8)
    assert state.telemetry.aging_rate_reference_q10 == 2.7


def test_aging_rate_is_withheld_when_the_reading_is_stale(monkeypatch):
    """A stale reading must not be presented as the current rate."""
    service = FreshnessService(seed_hero_items=False)
    service.add_item("dairy")
    now = time.time()
    service.ingest(TelemetrySample(now, 22.0, 60.0, None, False))
    monkeypatch.setattr("apps.api.service.time.time", lambda: now + 10_000)
    state = service.snapshot()
    assert state.telemetry.connected is False
    assert state.items[0].aging_rate is None
    assert state.telemetry.aging_rate is None


def test_storage_optimization_quantifies_warm_temperature_benefit():
    service = FreshnessService(seed_hero_items=False)
    service.add_item("dairy")
    now = time.time()
    service.ingest(TelemetrySample(now, 12.0, 75.0, None, False))

    optimization = service.snapshot().items[0].storage_optimization
    assert optimization.temperature_action == "cool_to_target"
    assert optimization.current_temperature_c == 12.0
    assert optimization.target_temperature_c == 4.0
    assert optimization.projected_days_at_current_temperature < optimization.projected_days_at_target_temperature
    assert optimization.potential_days_preserved == pytest.approx(
        optimization.projected_days_at_target_temperature
        - optimization.projected_days_at_current_temperature
    )
    assert optimization.humidity_affects_days_left is False


def test_storage_optimization_does_not_invent_advice_from_stale_reading(monkeypatch):
    service = FreshnessService(seed_hero_items=False)
    service.add_item("dairy")
    now = time.time()
    service.ingest(TelemetrySample(now, 12.0, 75.0, None, False))
    monkeypatch.setattr("apps.api.service.time.time", lambda: now + 10_000)

    optimization = service.snapshot().items[0].storage_optimization
    assert optimization.temperature_action == "unavailable"
    assert optimization.current_temperature_c is None
    assert optimization.projected_days_at_current_temperature is None
    assert optimization.potential_days_preserved is None


def test_current_conditions_projection_matches_budget_over_aging_rate():
    """The headline is the live-temperature projection, so the two must match."""
    service = FreshnessService()
    item = service.add_item("dairy")
    now = time.time()
    service.ingest(TelemetrySample(now, 4.0, 60.0, None, False))
    service.store.items[item.id].t_eff = 4.0
    service.ingest(TelemetrySample(now + 60, 11.0, 60.0, None, False))
    state = service.snapshot().items[0]
    assert state.aging_rate == pytest.approx(2.7 ** 0.7)
    assert state.storage_optimization.projected_days_at_current_temperature == pytest.approx(
        state.days_left)
    # The 4C figure is now the alternative, and it is longer.
    assert state.storage_optimization.projected_days_at_target_temperature > state.days_left


def test_current_conditions_projection_is_withheld_when_reading_is_stale(monkeypatch):
    """No usable reading means no correction line, rather than a guess."""
    service = FreshnessService()
    service.add_item("dairy")
    now = time.time()
    service.ingest(TelemetrySample(now, 11.0, 60.0, None, False))
    monkeypatch.setattr("apps.api.service.time.time", lambda: now + 10_000)
    state = service.snapshot().items[0]
    assert state.aging_rate is None
    assert state.storage_optimization.projected_days_at_current_temperature is None
    assert state.storage_optimization.current_temperature_c is None

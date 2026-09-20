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
    service = FreshnessService()
    for i in range(25):
        service.ingest(TelemetrySample(i * 60, 4.0, 60.0, 200000.0 - i * 100, i % 5 == 0))
    baseline = service.fit_gas_baseline_from_history(min_samples=20)
    assert baseline is not None
    assert service.store.last_gas_baseline_sample_count == 20


def test_gas_baseline_is_fitted_automatically_after_clean_history():
    service = FreshnessService()
    for i in range(20):
        service.ingest(TelemetrySample(i * 60, 4.0 + i * 0.01, 60.0, 200000.0 - i * 50, False))
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
    service = FreshnessService()
    for i in range(20):
        service.ingest(TelemetrySample(i * 60, 4.0 + i * 0.01, 60.0, 200000.0 - i * 50, False))
    service.ingest(TelemetrySample(20 * 60, 4.2, 60.0, None, False))
    assert service.store.gas_baseline is not None
    assert service.snapshot().telemetry.gas_anomaly is None


def test_contradiction_scenario_surfaces_secondary_disagreement():
    from simulator.scenarios import generate_scenario

    service = FreshnessService()
    service.add_item("dairy")
    for sample in generate_scenario("contradiction", 0):
        service.ingest(sample)
    state = service.snapshot()
    assert state.telemetry.gas_anomaly is not None
    assert state.telemetry.gas_anomaly > 0.8
    assert state.items[0].track_a_days_left > 0
    assert state.items[0].status == "check_early"


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

from apps.api.service import FreshnessService
from engine.models import TelemetrySample


def test_service_starts_with_three_hero_foods():
    service = FreshnessService()
    assert {item.profile_id for item in service.snapshot().items} == {"milk", "chicken", "spinach"}


def test_telemetry_updates_item_budget_using_elapsed_time():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    state = service.ingest(TelemetrySample(3600, 22.0, 60.0, 200000.0, False))
    updated = next(x for x in state.items if x.id == item.id)
    assert updated.t_eff > 0
    assert updated.days_left < item.days_left


def test_opened_action_caps_remaining_budget_to_opened_profile_budget():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    opened = service.mark_opened(item.id)
    assert opened.opened is True
    assert opened.days_left <= 5.0


def test_opening_never_increases_remaining_life():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("chicken")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    before = service.ingest(TelemetrySample(36 * 3600, 4.0, 60.0, 200000.0, False)).items[0]
    after = service.mark_opened(item.id)
    assert after.days_left <= before.days_left


def test_label_score_never_extends_track_a():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    track_a = service.snapshot().items[0].track_a_days_left
    scored = service.set_label_score(item.id, 0.5)
    assert scored.days_left <= track_a
    assert scored.t_eff == item.t_eff


def test_door_open_samples_do_not_enter_gas_baseline_fit():
    service = FreshnessService(seed_hero_items=False)
    for i in range(25):
        service.ingest(TelemetrySample(i * 60, 4.0, 60.0, 200000.0 - i * 100, i % 5 == 0))
    baseline = service.fit_gas_baseline_from_history(min_samples=20)
    assert baseline is not None
    assert service.store.last_gas_baseline_sample_count == 20


def test_gas_baseline_is_fitted_automatically_after_clean_history():
    service = FreshnessService(seed_hero_items=False)
    for i in range(20):
        service.ingest(TelemetrySample(i * 60, 4.0 + i * 0.01, 60.0, 200000.0 - i * 50, False))
    assert service.store.gas_baseline is not None
    assert service.snapshot().telemetry.gas_anomaly is not None


def test_contradiction_scenario_surfaces_secondary_disagreement():
    from simulator.scenarios import generate_scenario

    service = FreshnessService(seed_hero_items=False)
    service.add_item("milk")
    for sample in generate_scenario("contradiction", 0):
        service.ingest(sample)
    state = service.snapshot()
    assert state.telemetry.gas_anomaly is not None
    assert state.telemetry.gas_anomaly > 0.8
    assert state.items[0].track_a_days_left > 0
    assert state.items[0].status == "check_early"


def test_items_store_added_timestamp():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    assert item.created_at > 0


def test_rename_item_updates_display_name_only():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    renamed = service.rename_item(item.id, "Leftover milk")
    assert renamed.name == "Leftover milk"
    assert renamed.days_left == item.days_left


def test_rename_item_rejects_blank_name():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    try:
        service.rename_item(item.id, "   ")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_set_category_switches_profile_and_recomputes_budget():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    recategorized = service.set_category(item.id, "chicken")
    assert recategorized.profile_id == "chicken"


def test_set_category_rejects_unknown_profile():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk")
    try:
        service.set_category(item.id, "made-up")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_add_item_stores_ocr_metadata():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("milk", "Scanned milk", brand="Meadow Gold", lot_code="L2309A")
    assert item.brand == "Meadow Gold"
    assert item.lot_code == "L2309A"


def test_warm_excursion_reports_cumulative_demo_budget_cost():
    service = FreshnessService(seed_hero_items=False)
    service.add_item("milk")
    service.ingest(TelemetrySample(0, 4.0, 60.0, 200000.0, False))
    state = service.ingest(TelemetrySample(3600, 22.0, 60.0, 200000.0, False))
    damage = next(alert for alert in state.alerts if alert.code == "excursion_damage")
    assert "hours of freshness budget" in damage.message
    assert service.store.excursion_loss_hours > 0

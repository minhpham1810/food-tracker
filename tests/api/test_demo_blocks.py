import logging
import pytest
from apps.api.service import FreshnessService
from engine.models import TelemetrySample


def sample(ts, temp=4):
    return TelemetrySample(ts, temp, 60, None, False)


def test_backward_and_duplicate_samples_are_dropped(caplog):
    service = FreshnessService()
    service.add_item("dairy")
    service.ingest(sample(80))
    before = service.ingest(sample(100)).items[0].t_eff
    with caplog.at_level(logging.WARNING):
        service.ingest(sample(90))
        after = service.ingest(sample(100)).items[0].t_eff
    assert before > 0
    assert after == before
    assert service.store.latest_telemetry.timestamp == 100
    assert len(service.store.telemetry_history) == 2
    assert len(caplog.records) == 2


def test_stale_reading_age(monkeypatch):
    service = FreshnessService()
    monkeypatch.setattr('apps.api.service.time.time', lambda: 280)
    service.ingest(sample(100))
    assert service.snapshot().telemetry.connected
    monkeypatch.setattr('apps.api.service.time.time', lambda: 281)
    assert not service.snapshot().telemetry.connected
    assert service.snapshot().telemetry.reading_age_seconds == 181


@pytest.mark.parametrize('temperature', [-18, -1.1, 25.1, 40])
def test_outside_model_stops_integration_and_persists_warning(tmp_path, temperature):
    path = str(tmp_path / 'range.sqlite3')
    service = FreshnessService(storage_path=path)
    service.add_item("dairy")
    service.ingest(sample(0))
    state = service.ingest(sample(60, temperature))
    assert state.items, "no item to assert on: all() would pass vacuously"
    assert all(i.t_eff == 0 and i.outside_model_range and i.confidence == 'low' for i in state.items)
    restarted = FreshnessService(storage_path=path)
    assert restarted.snapshot().items
    assert all(i.model_message == 'outside modelled range' for i in restarted.snapshot().items)


def test_buffer_covers_24_hours_at_20_second_cadence():
    service = FreshnessService(seed_hero_items=False)
    for n in range(5000):
        service.store.append_telemetry(TelemetrySample(n * 20, 4, 60, 200000, False, 3))
    assert service.fit_gas_baseline_from_history() is not None


def test_gas_is_fridge_level_only_and_calibration_is_unused(monkeypatch):
    service = FreshnessService(experimental_fusion=False)
    service.add_item("dairy")
    service.ingest(sample(0))
    monkeypatch.setattr(service, '_latest_gas_anomaly', lambda: 1.0)
    state = service.snapshot()
    assert state.telemetry.gas_anomaly == 1.0
    assert state.items, "no item to assert on: the loop would pass vacuously"
    for item in state.items:
        assert item.days_left == item.track_a_days_left
        assert item.days_left > 0
        assert item.gas_anomaly is None
        assert not item.fusion_uncertainty.used_for_estimate
        assert item.fusion_uncertainty.sigma_b_reason == 'unused_gas_fusion_disabled'


def test_projection_uses_4c_while_past_exposure_uses_recorded_temperature():
    from engine.burn import rate_multiplier, update_budget
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item('dairy')
    service.ingest(sample(0, 4))
    state = service.ingest(sample(60, 22)).items[0]
    expected_damage = update_budget(0, 22, 1 / 60, 2.7)
    assert state.t_eff == pytest.approx(expected_damage)
    assert state.days_left == pytest.approx(6 - expected_damage)
    assert state.projection_temperature_c == 4
    assert state.d0_source == 'usda-fsis'
    assert state.q10_source == 'fitted-published-multitemp'
    assert state.profile_name == 'Dairy'


def test_category_change_replays_with_new_q10_and_clips_tracking_start(monkeypatch):
    from engine.burn import rate_multiplier, update_budget
    monkeypatch.setattr('apps.api.service.time.time', lambda: 0)
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item('dairy')
    service.ingest(sample(0, 22))
    service.ingest(sample(120, 22))
    corrected = service.set_category(item.id, 'poultry')
    assert corrected.t_eff == pytest.approx(update_budget(0, 22, 120 / 3600, 2.7))
    assert corrected.days_left == pytest.approx((2 - corrected.t_eff) / rate_multiplier(22, 2.7))


def test_category_change_refuses_missing_history_without_changing_item(monkeypatch):
    monkeypatch.setattr('apps.api.service.time.time', lambda: 0)
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item('dairy')
    service.ingest(sample(0, 22))
    service.ingest(sample(120, 22))
    before = service.get_item(item.id)
    service.store.telemetry_history = service.store.telemetry_history[1:]
    with pytest.raises(ValueError, match='does not cover tracking start'):
        service.set_category(item.id, 'poultry')
    after = service.get_item(item.id)
    assert after.profile_id == before.profile_id
    assert after.t_eff == before.t_eff


def test_ocr_requires_category_confirmation_and_timeout_offers_manual(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    from apps.api import main
    from apps.api.vision_ocr import _timeout_seconds
    client = TestClient(main.app)
    assert client.post('/api/ocr/confirm', json={'profile_id': 'dairy'}).status_code == 400
    monkeypatch.setenv('OCR_TIMEOUT_SECONDS', '600')
    assert _timeout_seconds() == 60
    def timeout(_):
        raise httpx.ReadTimeout('expired')
    monkeypatch.setattr(main.ocr_module, 'scan_images', timeout)
    response = client.post('/api/ocr/scan', files={'image': ('label.jpg', b'x', 'image/jpeg')})
    assert response.status_code == 503
    assert 'Enter the item manually' in response.json()['detail']

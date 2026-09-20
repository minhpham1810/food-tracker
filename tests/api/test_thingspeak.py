import asyncio
import logging
from datetime import datetime

import pytest

import httpx

from apps.api.service import FreshnessService
from apps.api.thingspeak import ThingSpeakConfig, ThingSpeakPoller, parse_feed


def _entry(entry_id, created_at, temp="22.2", rh="53.7", gas="219884.0", flags="63"):
    return {
        "entry_id": entry_id,
        "created_at": created_at,
        "field1": temp,
        "field2": rh,
        "field3": "10.040",
        "field4": gas,
        "field5": "9.2985",
        "field6": "149.09",
        "field7": flags,
        "field8": "54575",
    }


def test_parse_feed_maps_bme688_fields_and_orders_by_entry():
    parsed = parse_feed(
        [
            _entry(27, "2026-09-19T06:02:26Z", temp="22.172"),
            _entry(26, "2026-09-19T06:02:03Z"),
        ],
    )
    assert [entry_id for entry_id, _ in parsed] == [26, 27]
    sample = parsed[1][1]
    assert sample.temperature == 22.172
    assert sample.humidity == 53.7
    assert sample.gas_resistance == 219884.0
    assert sample.iaq_accuracy == 3
    assert sample.door_open is False
    assert sample.timestamp - parsed[0][1].timestamp == 23


def test_parse_feed_drops_missing_and_invalid_readings():
    parsed = parse_feed(
        [
            _entry(1, "2026-09-19T06:00:00Z", temp=None),
            _entry(2, "2026-09-19T06:00:20Z", rh="140"),
            _entry(4, "2026-09-19T06:01:00Z"),
        ],
    )
    assert [entry_id for entry_id, _ in parsed] == [4]


def test_bad_gas_reading_keeps_temperature_and_humidity():
    # The uploader sends -1 in its score fields while the sensor warms up.
    parsed = parse_feed(
        [
            _entry(161, "2026-09-19T06:48:59Z", gas="-1.0"),
            _entry(162, "2026-09-19T06:49:19Z", gas="0"),
            _entry(163, "2026-09-19T06:49:39Z", gas=None),
        ],
    )
    assert [entry_id for entry_id, _ in parsed] == [161, 162, 163]
    assert all(sample.gas_resistance is None for _, sample in parsed)
    assert parsed[0][1].temperature == 22.2


@pytest.mark.parametrize("flags", ["47", "15", "0", None])
def test_gas_is_ignored_until_the_firmware_flags_say_it_is_usable(flags):
    # Anything but 63 means a hardware flag is clear or iaq_accuracy is below 3.
    [(_, sample)] = parse_feed([_entry(1, "2026-09-19T06:00:00Z", flags=flags)])
    assert sample.gas_resistance is None
    assert sample.humidity == 53.7
    assert sample.iaq_accuracy == (None if flags is None else (int(flags) >> 4) & 3)


def _poller(feeds_by_call, service):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        return httpx.Response(200, json={"channel": {}, "feeds": feeds_by_call[len(calls) - 1]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    config = ThingSpeakConfig(
        channel_id="3499736", read_api_key="KEY", poll_seconds=15
    )
    return ThingSpeakPoller(config, service.ingest, service.store, client=client,
                           history_callback=service.restore_complete_history), calls


def test_first_poll_takes_only_latest_then_only_new_entries():
    service = FreshnessService()
    poller, calls = _poller(
        [
            [_entry(10, "2026-09-19T06:00:00Z")],
            [
                _entry(9, "2026-09-19T05:59:40Z"),
                _entry(10, "2026-09-19T06:00:00Z"),
                _entry(11, "2026-09-19T06:00:20Z", temp="23.0"),
            ],
        ],
        service,
    )

    assert asyncio.run(poller.poll_once()) == 1
    assert asyncio.run(poller.poll_once()) == 1
    assert calls[0]["results"] == "1"
    assert calls[0]["api_key"] == "KEY"
    assert poller.last_entry_id == 11
    assert service.snapshot().telemetry.temperature == 23.0
    assert len(service.store.telemetry_history) == 2


def test_poll_advances_past_invalid_entries_and_warns_once(caplog):
    service = FreshnessService()
    bad = _entry(20, "2026-09-19T06:00:00Z", temp=None)
    poller, _ = _poller(
        [[bad], [bad, _entry(21, "2026-09-19T06:00:20Z", gas="-1.0")]], service
    )

    with caplog.at_level(logging.WARNING, logger="apps.api.thingspeak"):
        assert asyncio.run(poller.poll_once()) == 0
        assert asyncio.run(poller.poll_once()) == 1

    assert poller.last_entry_id == 21
    assert len([r for r in caplog.records if "skipped" in r.message]) == 1
    telemetry = service.snapshot().telemetry
    assert telemetry.temperature == 22.2
    assert telemetry.gas_resistance is None
    assert telemetry.gas_anomaly is None


def test_poll_is_skipped_while_a_demo_scenario_runs():
    service = FreshnessService()
    service.store.active_scenario = "hot_car"
    poller, calls = _poller([[_entry(1, "2026-09-19T06:00:00Z")]], service)
    assert asyncio.run(poller.poll_once()) == 0
    assert calls == []


def test_config_is_off_without_a_channel(monkeypatch):
    monkeypatch.setenv("THINGSPEAK_CHANNEL_ID", "")
    assert ThingSpeakConfig.from_env() is None
    monkeypatch.setenv("THINGSPEAK_CHANNEL_ID", "3499736")
    monkeypatch.setenv("THINGSPEAK_READ_API_KEY", "")
    config = ThingSpeakConfig.from_env()
    assert config is not None and config.read_api_key is None



def test_truncated_five_day_history_is_flagged_and_survives_restart(tmp_path):
    from dataclasses import asdict
    from apps.api.schemas import ItemOut

    database = str(tmp_path / "history.sqlite3")
    service = FreshnessService(seed_hero_items=False, storage_path=database)
    item = service.add_item("eggs")
    first_timestamp = datetime.fromisoformat("2026-09-19T06:00:00+00:00").timestamp()
    service.store.items[item.id].created_at = first_timestamp - 5 * 86400
    poller, _ = _poller([[
        _entry(100, "2026-09-19T06:00:00Z"),
        _entry(101, "2026-09-19T06:00:20Z"),
    ]], service)
    asyncio.run(poller.poll_once())
    state = ItemOut(**asdict(service.get_item(item.id)))
    assert state.t_eff_incomplete is True
    assert state.confidence == "low"
    assert state.history_message == "partial history — estimate may be optimistic"

    restarted = FreshnessService(seed_hero_items=False, storage_path=database)
    assert restarted.get_item(item.id).t_eff == state.t_eff
    assert restarted.get_item(item.id).t_eff_incomplete is True
    # A normal catch-up, even with an overlapping entry, cannot clear the warning.
    catchup, _ = _poller([[
        _entry(101, "2026-09-19T06:00:20Z"),
        _entry(102, "2026-09-19T06:00:40Z"),
    ]], restarted)
    asyncio.run(catchup.poll_once())
    assert restarted.get_item(item.id).t_eff_incomplete is True
    assert restarted.get_item(item.id).confidence == "low"


def test_full_later_replay_repairs_budget_before_clearing_warning(tmp_path):
    from engine.burn import update_budget

    database = str(tmp_path / "repair.sqlite3")
    service = FreshnessService(seed_hero_items=False, storage_path=database)
    item = service.add_item("dairy")
    service.store.items[item.id].created_at = datetime.fromisoformat("2026-09-19T06:00:00+00:00").timestamp()
    entries = [_entry(i + 1, stamp, temp="4") for i, stamp in enumerate([
        "2026-09-19T06:00:00Z", "2026-09-19T06:00:20Z", "2026-09-19T06:00:40Z"])]
    poller, _ = _poller([entries[1:], entries, entries], service)
    asyncio.run(poller.poll_once())
    before = service.get_item(item.id)
    assert before.t_eff_incomplete is True
    asyncio.run(poller.poll_once())
    recovered = service.get_item(item.id)
    assert recovered.t_eff == pytest.approx(update_budget(0, 4, 40 / 3600, 2.5))
    assert recovered.t_eff > before.t_eff
    assert recovered.t_eff_incomplete is False
    assert recovered.history_message is None
    asyncio.run(poller.poll_once())
    assert service.get_item(item.id).t_eff == recovered.t_eff
    restarted = FreshnessService(seed_hero_items=False, storage_path=database)
    assert restarted.get_item(item.id).t_eff_incomplete is False


def test_normal_restart_preserves_complete_budget_without_old_history(tmp_path):
    database = str(tmp_path / "complete.sqlite3")
    service = FreshnessService(seed_hero_items=False, storage_path=database)
    item = service.add_item("eggs")
    record = service.store.items[item.id]
    record.created_at = datetime.fromisoformat("2026-09-14T06:00:00+00:00").timestamp()
    record.t_eff = 5.0
    entry = _entry(100, "2026-09-19T06:00:00Z")
    service.ingest(parse_feed([entry])[0][1])
    service.store.mark_processed_entry(100)
    restarted = FreshnessService(seed_hero_items=False, storage_path=database)
    poller, _ = _poller([[entry]], restarted)
    asyncio.run(poller.poll_once())
    state = restarted.get_item(item.id)
    assert state.t_eff == 5.0
    assert state.t_eff_incomplete is False


def test_empty_initial_history_flags_item():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("eggs")
    poller, _ = _poller([[]], service)
    asyncio.run(poller.poll_once())
    assert service.get_item(item.id).t_eff_incomplete is True
    assert service.get_item(item.id).confidence == "low"

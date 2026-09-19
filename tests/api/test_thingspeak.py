import asyncio

import httpx

from apps.api.service import FreshnessService
from apps.api.thingspeak import ThingSpeakConfig, ThingSpeakPoller, parse_feed


def _entry(entry_id, created_at, temp="22.2", rh="53.7", gas="219884.0"):
    return {
        "entry_id": entry_id,
        "created_at": created_at,
        "field1": temp,
        "field2": rh,
        "field3": "10.040",
        "field7": gas,
    }


def test_parse_feed_maps_bme688_fields_and_orders_by_entry():
    parsed = parse_feed(
        [
            _entry(27, "2026-09-19T06:02:26Z", temp="22.172"),
            _entry(26, "2026-09-19T06:02:03Z"),
        ]
    )
    assert [entry_id for entry_id, _ in parsed] == [26, 27]
    sample = parsed[1][1]
    assert sample.temperature == 22.172
    assert sample.humidity == 53.7
    assert sample.gas_resistance == 219884.0
    assert sample.door_open is False
    assert sample.timestamp - parsed[0][1].timestamp == 23


def test_parse_feed_drops_missing_and_invalid_readings():
    parsed = parse_feed(
        [
            _entry(1, "2026-09-19T06:00:00Z", temp=None),
            _entry(2, "2026-09-19T06:00:20Z", rh="140"),
            _entry(3, "2026-09-19T06:00:40Z", gas="0"),
            _entry(4, "2026-09-19T06:01:00Z"),
        ]
    )
    assert [entry_id for entry_id, _ in parsed] == [4]


def _poller(feeds_by_call, service):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.url.params))
        return httpx.Response(200, json={"channel": {}, "feeds": feeds_by_call[len(calls) - 1]})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    config = ThingSpeakConfig(channel_id="3499736", read_api_key="KEY", poll_seconds=15)
    return ThingSpeakPoller(config, service.ingest, service.store, client=client), calls


def test_first_poll_takes_only_latest_then_only_new_entries():
    service = FreshnessService(seed_hero_items=False)
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


def test_poll_is_skipped_while_a_demo_scenario_runs():
    service = FreshnessService(seed_hero_items=False)
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

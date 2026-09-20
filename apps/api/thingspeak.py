"""Live telemetry from the BME688 ThingSpeak channel.

The sensor uploads roughly every 20 s. field1 is temperature (C) and field2 is
humidity (%RH). The gas track needs raw gas resistance in ohms, which the
uploader does not always publish (its field7 has also carried a VOC percentage),
so the gas field is opt-in through THINGSPEAK_GAS_FIELD. Without it, samples
carry no gas reading and only the temperature track runs. The sensor has no door
switch, so every sample is door-closed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
import math
import logging
import os

import httpx

from engine.models import TelemetrySample

logger = logging.getLogger(__name__)

API_BASE_URL = "https://api.thingspeak.com"
# How many recent entries each poll asks for.
_POLL_RESULTS = 8000  # ThingSpeak maximum; covers about 44 hours at 20-second cadence.


@dataclass(frozen=True)
class ThingSpeakConfig:
    channel_id: str
    read_api_key: str | None
    poll_seconds: float
    # The field holding raw gas resistance in ohms, e.g. "field7". None skips gas.
    gas_field: str | None = None

    @classmethod
    def from_env(cls) -> ThingSpeakConfig | None:
        """None when no channel is configured, so the API still runs without one."""
        channel_id = os.environ.get("THINGSPEAK_CHANNEL_ID", "").strip()
        if not channel_id:
            return None
        return cls(
            channel_id=channel_id,
            read_api_key=os.environ.get("THINGSPEAK_READ_API_KEY", "").strip() or None,
            poll_seconds=float(os.environ.get("THINGSPEAK_POLL_SECONDS", "15")),
            gas_field=os.environ.get("THINGSPEAK_GAS_FIELD", "").strip() or None,
        )


def _gas_reading(entry: dict, gas_field: str | None) -> float | None:
    """Raw gas resistance, or None when absent or non-positive (the uploader
    sends -1 while the sensor warms up)."""
    if gas_field is None:
        return None
    try:
        value = float(entry[gas_field])
    except (KeyError, TypeError, ValueError):
        return None
    return value if value > 0.0 else None


def _iaq_accuracy(entry: dict) -> int | None:
    try:
        value = int(float(entry["field8"]))
    except (KeyError, TypeError, ValueError):
        return None
    return value if 0 <= value <= 3 else None


def _entry_id(entry: dict) -> int | None:
    try:
        return int(entry["entry_id"])
    except (KeyError, TypeError, ValueError):
        return None


def parse_feed(
    feeds: list[dict], gas_field: str | None = None
) -> list[tuple[int, TelemetrySample]]:
    """Turn ThingSpeak feed entries into (entry_id, sample) pairs.

    Entries with a missing or out-of-range temperature or humidity are dropped
    rather than guessed at, using the same limits as TelemetryIn. A bad gas
    reading only clears the sample's gas_resistance.
    """
    parsed: list[tuple[int, TelemetrySample]] = []
    for entry in feeds:
        entry_id = _entry_id(entry)
        if entry_id is None:
            continue
        try:
            timestamp = datetime.fromisoformat(entry["created_at"].replace("Z", "+00:00"))
            temperature = float(entry["field1"])
            humidity = float(entry["field2"])
        except (KeyError, TypeError, ValueError, AttributeError):
            continue
        if not 0.0 <= humidity <= 100.0:
            continue
        if not math.isfinite(temperature):
            continue
        parsed.append(
            (
                entry_id,
                TelemetrySample(
                    timestamp=timestamp.timestamp(),
                    temperature=temperature,
                    humidity=humidity,
                    gas_resistance=_gas_reading(entry, gas_field),
                    door_open=False,
                    iaq_accuracy=_iaq_accuracy(entry),
                ),
            )
        )
    parsed.sort(key=lambda pair: pair[0])
    return parsed


class ThingSpeakPoller:
    def __init__(
        self,
        config: ThingSpeakConfig,
        ingest_callback: Callable[[TelemetrySample], object],
        state_store,
        client: httpx.AsyncClient | None = None,
        history_callback: Callable[[list[TelemetrySample]], None] | None = None,
    ) -> None:
        self._config = config
        self._ingest = ingest_callback
        self._store = state_store
        self._client = client
        self._history_callback = history_callback
        self._task: asyncio.Task | None = None
        self.last_entry_id: int | None = state_store.last_processed_entry_id

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

    async def poll_once(self) -> int:
        """Fetch the channel and ingest entries newer than the last one seen.

        Persisted budgets remain authoritative. Missing history is flagged;
        only a complete replay can repair and clear a flagged item's budget.
        Returns the number of samples ingested.
        """
        # A running demo scenario owns the telemetry stream; live readings
        # would interleave with its synthetic timestamps.
        if self._store.active_scenario is not None:
            return 0

        params: dict[str, str | int] = {
            "results": _POLL_RESULTS
            if self.last_entry_id is not None or self._store.items
            else 1
        }
        incomplete = [item for item in self._store.items.values() if item.t_eff_incomplete]
        if (self.last_entry_id is None and self._store.items) or incomplete:
            requested_items = incomplete or list(self._store.items.values())
            oldest_item = min(item.created_at for item in requested_items)
            # Include a preceding reading so the item creation time is bracketed.
            params["start"] = datetime.fromtimestamp(oldest_item - 120, timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        elif self._store.latest_telemetry is not None:
            params["start"] = datetime.fromtimestamp(
                self._store.latest_telemetry.timestamp, timezone.utc
            ).strftime("%Y-%m-%d %H:%M:%S")
        if self._config.read_api_key:
            params["api_key"] = self._config.read_api_key
        url = f"{API_BASE_URL}/channels/{self._config.channel_id}/feeds.json"

        if self._client is not None:
            response = await self._client.get(url, params=params)
        else:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
        response.raise_for_status()
        # A private channel read without a valid key returns the body "-1".
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("ThingSpeak rejected the read; check THINGSPEAK_READ_API_KEY")

        history = parse_feed(body.get("feeds") or [], self._config.gas_field)
        oldest = min((sample.timestamp for _, sample in history), default=None)
        previous = self._store.latest_telemetry
        new_ids = [entry_id for entry_id, _ in history
                   if self.last_entry_id is None or entry_id > self.last_entry_id]
        lost_entries = (self.last_entry_id is not None and new_ids
                        and min(new_ids) > self.last_entry_id + 1)
        for item in self._store.items.values():
            needs_initial_history = (self.last_entry_id is None or previous is None
                                     or item.created_at > previous.timestamp)
            if ((needs_initial_history and (oldest is None or item.created_at < oldest))
                    or lost_entries):
                item.t_eff_incomplete = True
        # Store the warning before ingest so an interrupted replay retains it.
        self._store.persist()

        fresh = [
            entry
            for entry in body.get("feeds") or []
            if (entry_id := _entry_id(entry)) is not None
            and (self.last_entry_id is None or entry_id > self.last_entry_id)
        ]
        parsed = parse_feed(fresh, self._config.gas_field)
        if len(parsed) < len(fresh):
            logger.warning(
                "ThingSpeak: skipped %d of %d new entries with a missing or invalid "
                "temperature/humidity reading; check the channel's field mapping",
                len(fresh) - len(parsed),
                len(fresh),
            )
        for entry_id, sample in parsed:
            latest = self._store.latest_telemetry
            if latest is None or sample.timestamp > latest.timestamp:
                self._ingest(sample)
            self._store.mark_processed_entry(entry_id)
        # Advance past skipped entries too, so each one is reported only once.
        if fresh:
            self.last_entry_id = max(_entry_id(entry) for entry in fresh)
        contiguous = all(b[0] == a[0] + 1 for a, b in zip(history, history[1:]))
        if self._history_callback and history and contiguous:
            self._history_callback([sample for _, sample in history])
        return len(parsed)

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 -- keep polling through outages
                logger.warning("ThingSpeak poll failed: %s", exc)
            await asyncio.sleep(self._config.poll_seconds)

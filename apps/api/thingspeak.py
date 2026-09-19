"""Live telemetry from the BME688 ThingSpeak channel.

The sensor uploads roughly every 20 s. The channel's field mapping is fixed by
the uploader: field1 temperature (C), field2 humidity (%RH), field7 raw gas
resistance (ohm). The other fields (pressure, BSEC IAQ outputs) are not used by
the engine. The sensor has no door switch, so every sample is door-closed.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
import logging
import os

import httpx

from engine.models import TelemetrySample

logger = logging.getLogger(__name__)

API_BASE_URL = "https://api.thingspeak.com"
# How many recent entries each poll asks for. At one upload per 20 s this
# covers a ~30 minute outage before entries are skipped.
_POLL_RESULTS = 100


@dataclass(frozen=True)
class ThingSpeakConfig:
    channel_id: str
    read_api_key: str | None
    poll_seconds: float

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
        )


def parse_feed(feeds: list[dict]) -> list[tuple[int, TelemetrySample]]:
    """Turn ThingSpeak feed entries into (entry_id, sample) pairs.

    Entries with a missing or out-of-range reading are dropped rather than
    guessed at, using the same limits as TelemetryIn.
    """
    parsed: list[tuple[int, TelemetrySample]] = []
    for entry in feeds:
        try:
            entry_id = int(entry["entry_id"])
            timestamp = datetime.fromisoformat(entry["created_at"].replace("Z", "+00:00"))
            temperature = float(entry["field1"])
            humidity = float(entry["field2"])
            gas_resistance = float(entry["field7"])
        except (KeyError, TypeError, ValueError):
            continue
        if not 0.0 <= humidity <= 100.0 or gas_resistance <= 0.0:
            continue
        parsed.append(
            (
                entry_id,
                TelemetrySample(
                    timestamp=timestamp.timestamp(),
                    temperature=temperature,
                    humidity=humidity,
                    gas_resistance=gas_resistance,
                    door_open=False,
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
    ) -> None:
        self._config = config
        self._ingest = ingest_callback
        self._store = state_store
        self._client = client
        self._task: asyncio.Task | None = None
        self.last_entry_id: int | None = None

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

        The first poll ingests only the newest entry: every item's budget burns
        from whatever history is ingested, so replaying readings from before the
        server started would charge items for time they weren't being tracked.
        Returns the number of samples ingested.
        """
        # A running demo scenario owns the telemetry stream; live readings
        # would interleave with its synthetic timestamps.
        if self._store.active_scenario is not None:
            return 0

        params: dict[str, str | int] = {
            "results": 1 if self.last_entry_id is None else _POLL_RESULTS
        }
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

        ingested = 0
        for entry_id, sample in parse_feed(body.get("feeds") or []):
            if self.last_entry_id is not None and entry_id <= self.last_entry_id:
                continue
            self._ingest(sample)
            self.last_entry_id = entry_id
            ingested += 1
        return ingested

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 -- keep polling through outages
                logger.warning("ThingSpeak poll failed: %s", exc)
            await asyncio.sleep(self._config.poll_seconds)

import asyncio
from collections.abc import Callable

from engine.models import TelemetrySample

from .scenarios import generate_scenario


class SensorSimulator:
    def __init__(
        self,
        ingest_callback: Callable[[TelemetrySample], object],
        reset_callback: Callable[[], object],
        state_store,
    ) -> None:
        self._ingest = ingest_callback
        self._reset = reset_callback
        self._store = state_store
        self._task: asyncio.Task | None = None

    async def start(self, name: str) -> None:
        # Validate before altering current simulation state.
        start_timestamp = (
            self._store.latest_telemetry.timestamp + 60
            if self._store.latest_telemetry is not None
            else 0.0
        )
        samples = generate_scenario(name, start_timestamp)
        await self.stop(mark_paused=False)
        self._store.active_scenario = name
        self._store.telemetry_paused = False
        self._task = asyncio.create_task(self._run(name, samples))

    async def _run(self, name: str, samples: list[TelemetrySample]) -> None:
        try:
            for sample in samples:
                self._ingest(sample)
                await asyncio.sleep(0.25)
        except asyncio.CancelledError:
            raise
        finally:
            if self._store.active_scenario == name:
                self._store.active_scenario = None
                self._store.telemetry_paused = True

    async def stop(self, mark_paused: bool = True) -> None:
        task = self._task
        self._task = None
        if task is not None and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._store.active_scenario = None
        if mark_paused:
            self._store.telemetry_paused = True

    async def reset(self) -> None:
        await self.stop(mark_paused=False)
        self._reset()

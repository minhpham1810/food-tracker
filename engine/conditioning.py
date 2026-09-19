from collections import OrderedDict

import numpy as np
from scipy.ndimage import median_filter

from .models import TelemetrySample


def gas_baseline_samples(samples: list[TelemetrySample]) -> list[TelemetrySample]:
    return [sample for sample in samples if not sample.door_open]


def condition_samples(
    samples: list[TelemetrySample], grid_seconds: int = 60
) -> list[TelemetrySample]:
    if not samples:
        return []
    if grid_seconds <= 0:
        raise ValueError("grid_seconds must be positive")

    # Sort and collapse duplicate timestamps, retaining the last sample.
    collapsed: OrderedDict[float, TelemetrySample] = OrderedDict()
    for sample in sorted(samples, key=lambda item: item.timestamp):
        collapsed[sample.timestamp] = sample
    ordered = list(collapsed.values())

    timestamps = np.asarray([x.timestamp for x in ordered], dtype=float)
    temperatures = median_filter(
        np.asarray([x.temperature for x in ordered], dtype=float), size=5
    )
    humidity = np.asarray([x.humidity for x in ordered], dtype=float)
    resistance = median_filter(
        np.asarray([x.gas_resistance for x in ordered], dtype=float), size=5
    )

    start, end = float(timestamps[0]), float(timestamps[-1])
    grid = np.arange(start, end + 1e-9, grid_seconds, dtype=float)

    temp_interp = np.interp(grid, timestamps, temperatures)
    humidity_interp = np.interp(grid, timestamps, humidity)
    resistance_interp = np.interp(grid, timestamps, resistance)

    # Nearest-previous door state (zero-order hold).
    door_indices = np.searchsorted(timestamps, grid, side="right") - 1
    door_indices = np.clip(door_indices, 0, len(ordered) - 1)

    return [
        TelemetrySample(
            timestamp=float(ts),
            temperature=float(temp),
            humidity=float(rh),
            gas_resistance=float(rgas),
            door_open=ordered[int(idx)].door_open,
        )
        for ts, temp, rh, rgas, idx in zip(
            grid, temp_interp, humidity_interp, resistance_interp, door_indices
        )
    ]

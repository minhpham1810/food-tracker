import json
import math
from pathlib import Path

from engine.models import TelemetrySample


def _definitions() -> dict[str, dict[str, float | int]]:
    path = Path(__file__).with_name("scenarios.json")
    return json.loads(path.read_text(encoding="utf-8"))


def available_scenarios() -> tuple[str, ...]:
    return tuple(_definitions().keys())


def _lerp(start: float, end: float, fraction: float) -> float:
    return start + (end - start) * fraction


def generate_scenario(
    name: str, start_timestamp: float, step_seconds: int = 60
) -> list[TelemetrySample]:
    definitions = _definitions()
    if name not in definitions:
        raise ValueError(f"Unknown scenario: {name}")
    config = definitions[name]
    count = int(config["samples"])
    if not 1 <= count <= 180:
        raise ValueError("scenario sample count must be between 1 and 180")

    timestamp_step = int(config.get("timestamp_step_seconds", step_seconds))
    if timestamp_step <= 0:
        raise ValueError("timestamp step must be positive")
    clean_prefix = int(config.get("clean_prefix", 0))
    door_after = config.get("door_open_after")

    samples: list[TelemetrySample] = []
    for index in range(count):
        fraction = index / max(1, count - 1)
        wave = math.sin(index * 0.55)
        temperature = _lerp(
            float(config["temperature_start"]),
            float(config["temperature_end"]),
            fraction,
        ) + 0.08 * wave
        humidity = _lerp(
            float(config["humidity_start"]),
            float(config["humidity_end"]),
            fraction,
        ) + 0.25 * wave

        gas_start = float(config["gas_start"])
        gas_end = float(config["gas_end"])
        if clean_prefix and index < clean_prefix:
            gas_fraction = 0.0
            gas = gas_start + 900.0 * wave
        elif clean_prefix:
            gas_fraction = (index - clean_prefix) / max(1, count - clean_prefix - 1)
            gas = _lerp(gas_start, gas_end, gas_fraction) + 900.0 * wave
        else:
            gas = _lerp(gas_start, gas_end, fraction) + 900.0 * wave

        samples.append(
            TelemetrySample(
                timestamp=float(start_timestamp + index * timestamp_step),
                temperature=float(temperature),
                humidity=float(max(0.0, min(100.0, humidity))),
                gas_resistance=float(max(1.0, gas)),
                door_open=bool(door_after is not None and index >= int(door_after)),
            )
        )
    return samples

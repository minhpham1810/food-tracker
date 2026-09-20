"""Retunable gas-baseline thresholds."""
from dataclasses import dataclass
import os

@dataclass(frozen=True)
class GasBaselineConfig:
    min_samples: int = 500
    min_span_hours: float = 24.0
    min_rh_std: float = 3.0
    min_temperature_std: float = 0.5
    max_condition_number: float = 1e6

def gas_baseline_config() -> GasBaselineConfig:
    return GasBaselineConfig(
        min_samples=int(os.getenv("GAS_MIN_SAMPLES", "500")),
        min_span_hours=float(os.getenv("GAS_MIN_SPAN_HOURS", "24")),
        min_rh_std=float(os.getenv("GAS_MIN_RH_STD", "3")),
        min_temperature_std=float(os.getenv("GAS_MIN_T_STD", "0.5")),
        max_condition_number=float(os.getenv("GAS_MAX_CONDITION_NUMBER", "1000000")),
    )

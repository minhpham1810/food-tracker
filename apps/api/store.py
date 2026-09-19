from dataclasses import dataclass, field
from typing import Optional

from engine.models import GasBaseline, TelemetrySample


@dataclass
class ItemRecord:
    id: str
    profile_id: str
    name: str
    active_d0_days: float
    created_at: float
    t_eff: float = 0.0
    opened: bool = False
    color_score: float | None = None
    brand: str | None = None
    printed_date: str | None = None
    package_size: str | None = None
    lot_code: str | None = None


@dataclass
class AlertRecord:
    code: str
    message: str
    severity: str = "info"


@dataclass
class AppStore:
    items: dict[str, ItemRecord] = field(default_factory=dict)
    telemetry_history: list[TelemetrySample] = field(default_factory=list)
    latest_telemetry: Optional[TelemetrySample] = None
    gas_baseline: Optional[GasBaseline] = None
    last_gas_baseline_sample_count: int = 0
    alerts: list[AlertRecord] = field(default_factory=list)
    active_scenario: str | None = None
    telemetry_paused: bool = False

    def append_telemetry(self, sample: TelemetrySample) -> None:
        self.telemetry_history.append(sample)
        if len(self.telemetry_history) > 1440:
            del self.telemetry_history[:-1440]
        self.latest_telemetry = sample

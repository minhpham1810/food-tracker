from dataclasses import dataclass, field
from typing import Optional

from engine.models import GasBaseline, TelemetrySample

_MAX_PENDING_SCAN_PHOTOS = 20


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
    # JPEG thumbnail of the label photo this item was scanned from, if any.
    photo: bytes | None = None


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
    # Thumbnails from /ocr/scan waiting for the /ocr/confirm that adopts them.
    # A scan the user abandons never gets collected, hence the cap.
    scan_photos: dict[str, bytes] = field(default_factory=dict)

    def stash_scan_photo(self, scan_id: str, photo: bytes) -> None:
        self.scan_photos[scan_id] = photo
        for stale in list(self.scan_photos)[:-_MAX_PENDING_SCAN_PHOTOS]:
            del self.scan_photos[stale]

    def append_telemetry(self, sample: TelemetrySample) -> None:
        self.telemetry_history.append(sample)
        if len(self.telemetry_history) > 1440:
            del self.telemetry_history[:-1440]
        self.latest_telemetry = sample

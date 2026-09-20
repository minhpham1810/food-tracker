from dataclasses import dataclass, field
import json
from pathlib import Path
import sqlite3
from typing import Optional

from engine.models import GasBaseline, TelemetrySample

_MAX_PENDING_SCAN_PHOTOS = 20
MAX_TELEMETRY_SAMPLES = 10000  # More than 55 hours at the 20-second upload cadence.


@dataclass
class ItemRecord:
    id: str
    profile_id: str
    name: str
    active_d0_days: float
    created_at: float
    opened_at: float | None = None
    t_eff: float = 0.0
    opened: bool = False
    color_score: float | None = None
    brand: str | None = None
    printed_date: str | None = None
    package_size: str | None = None
    lot_code: str | None = None
    # JPEG thumbnail of the label photo this item was scanned from, if any.
    photo: bytes | None = None
    state: str = "fresh"
    t_eff_incomplete: bool = False
    outside_model_range: bool = False


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
    storage_path: str | None = None
    last_processed_entry_id: int | None = None
    data_gap_hours: float = 0.0

    def __post_init__(self) -> None:
        if self.storage_path:
            self._load_from_sqlite()

    def _connect(self) -> sqlite3.Connection:
        path = self.storage_path or ":memory:"
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, name TEXT NOT NULL,
                active_d0_days REAL NOT NULL, created_at REAL NOT NULL, opened_at REAL,
                t_eff REAL NOT NULL, opened INTEGER NOT NULL, color_score REAL,
                brand TEXT, printed_date TEXT, package_size TEXT, lot_code TEXT,
                photo BLOB, state TEXT NOT NULL, last_processed_entry_id INTEGER
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS telemetry (
                timestamp REAL PRIMARY KEY, temperature REAL NOT NULL,
                humidity REAL NOT NULL, gas_resistance REAL, door_open INTEGER NOT NULL,
                iaq_accuracy INTEGER
            )"""
        )
        item_columns = {row[1] for row in connection.execute("PRAGMA table_info(items)")}
        if "t_eff_incomplete" not in item_columns:
            connection.execute("ALTER TABLE items ADD COLUMN t_eff_incomplete INTEGER NOT NULL DEFAULT 0")
        if "outside_model_range" not in item_columns:
            connection.execute("ALTER TABLE items ADD COLUMN outside_model_range INTEGER NOT NULL DEFAULT 0")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(telemetry)")}
        if "iaq_accuracy" not in columns:
            connection.execute("ALTER TABLE telemetry ADD COLUMN iaq_accuracy INTEGER")
        connection.execute(
            "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        connection.commit()
        return connection

    def _load_from_sqlite(self) -> None:
        connection = self._connect()
        try:
            rows = connection.execute(
                "SELECT id, profile_id, name, active_d0_days, created_at, opened_at, "
                "t_eff, opened, color_score, brand, printed_date, package_size, lot_code, photo, state, t_eff_incomplete, outside_model_range "
                "FROM items"
            )
            for row in rows:
                item = ItemRecord(
                    id=row[0], profile_id=row[1], name=row[2], active_d0_days=row[3],
                    created_at=row[4], opened_at=row[5], t_eff=row[6], opened=bool(row[7]),
                    color_score=row[8], brand=row[9], printed_date=row[10],
                    package_size=row[11], lot_code=row[12], photo=row[13], state=row[14],
                    t_eff_incomplete=bool(row[15]),
                    outside_model_range=bool(row[16]),
                )
                self.items[item.id] = item
            rows = connection.execute(
                "SELECT timestamp, temperature, humidity, gas_resistance, door_open, iaq_accuracy "
                f"FROM telemetry ORDER BY timestamp DESC LIMIT {MAX_TELEMETRY_SAMPLES}"
            ).fetchall()
            self.telemetry_history = [
                TelemetrySample(
                    timestamp=row[0], temperature=row[1], humidity=row[2],
                    gas_resistance=row[3], door_open=bool(row[4]), iaq_accuracy=row[5],
                )
                for row in reversed(rows)
            ]
            self.latest_telemetry = self.telemetry_history[-1] if self.telemetry_history else None
            metadata = dict(connection.execute("SELECT key, value FROM metadata"))
            self.data_gap_hours = float(metadata.get("data_gap_hours", 0))
            raw_entry = metadata.get("last_processed_entry_id")
            self.last_processed_entry_id = int(raw_entry) if raw_entry else None
            raw_baseline = metadata.get("gas_baseline")
            if raw_baseline:
                baseline = json.loads(raw_baseline)
                self.gas_baseline = GasBaseline(
                    beta=tuple(baseline["beta"]),
                    residual_mean=baseline["residual_mean"],
                    baseline_residual_sigma=(baseline["baseline_residual_sigma"]
                        if "baseline_residual_sigma" in baseline else baseline["residual_std"]),
                    r2=baseline.get("r2", 0.0),
                    condition_number=baseline.get("condition_number", 0.0),
                    interaction=baseline.get("interaction", len(baseline["beta"]) == 4),
                )
            self.last_gas_baseline_sample_count = int(metadata.get("gas_sample_count", 0))
        finally:
            connection.close()

    def persist(self) -> None:
        if not self.storage_path:
            return
        connection = self._connect()
        try:
            with connection:
                ids = list(self.items)
                if ids:
                    marks = ",".join("?" for _ in ids)
                    connection.execute(f"DELETE FROM items WHERE id NOT IN ({marks})", ids)
                else:
                    connection.execute("DELETE FROM items")
                connection.executemany(
                    """INSERT OR REPLACE INTO items (id, profile_id, name, active_d0_days, created_at,
                    opened_at, t_eff, opened, color_score, brand, printed_date, package_size,
                    lot_code, photo, state, last_processed_entry_id, t_eff_incomplete, outside_model_range)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [(
                        item.id, item.profile_id, item.name, item.active_d0_days, item.created_at,
                        item.opened_at, item.t_eff, int(item.opened), item.color_score, item.brand,
                        item.printed_date, item.package_size, item.lot_code, item.photo,
                        item.state, self.last_processed_entry_id, int(item.t_eff_incomplete), int(item.outside_model_range),
                    ) for item in self.items.values()],
                )
                connection.execute("DELETE FROM telemetry")
                connection.executemany(
                    "INSERT INTO telemetry (timestamp, temperature, humidity, gas_resistance, door_open, iaq_accuracy) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    [(
                        sample.timestamp, sample.temperature, sample.humidity,
                        sample.gas_resistance, int(sample.door_open), sample.iaq_accuracy,
                    ) for sample in self.telemetry_history],
                )
                connection.execute("DELETE FROM metadata")
                connection.execute("INSERT INTO metadata(key, value) VALUES (?, ?)",
                                   ("data_gap_hours", str(self.data_gap_hours)))
                if self.last_processed_entry_id is not None:
                    connection.execute(
                        "INSERT INTO metadata(key, value) VALUES (?, ?)",
                        ("last_processed_entry_id", str(self.last_processed_entry_id)),
                    )
                if self.gas_baseline is not None:
                    connection.execute(
                        "INSERT INTO metadata(key, value) VALUES (?, ?)",
                        ("gas_baseline", json.dumps({
                            "beta": self.gas_baseline.beta,
                            "residual_mean": self.gas_baseline.residual_mean,
                            "baseline_residual_sigma": self.gas_baseline.baseline_residual_sigma,
                            "r2": self.gas_baseline.r2,
                            "condition_number": self.gas_baseline.condition_number,
                            "interaction": self.gas_baseline.interaction,
                        })),
                    )
                connection.execute(
                    "INSERT INTO metadata(key, value) VALUES (?, ?)",
                    ("gas_sample_count", str(self.last_gas_baseline_sample_count)),
                )
        finally:
            connection.close()

    def mark_processed_entry(self, entry_id: int) -> None:
        self.last_processed_entry_id = entry_id
        self.persist()

    def stash_scan_photo(self, scan_id: str, photo: bytes) -> None:
        self.scan_photos[scan_id] = photo
        for stale in list(self.scan_photos)[:-_MAX_PENDING_SCAN_PHOTOS]:
            del self.scan_photos[stale]

    def append_telemetry(self, sample: TelemetrySample) -> None:
        self.telemetry_history.append(sample)
        if len(self.telemetry_history) > MAX_TELEMETRY_SAMPLES:
            del self.telemetry_history[:-MAX_TELEMETRY_SAMPLES]
        self.latest_telemetry = sample

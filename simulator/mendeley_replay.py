import csv
from pathlib import Path

from engine.models import TelemetrySample

_REQUIRED_COLUMNS = {"Minute", "Temperature", "Humidity"}


def load_mendeley_csv(path: Path, sensor_column: str | None = None) -> list[TelemetrySample]:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)

    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        missing = _REQUIRED_COLUMNS - set(headers)
        if missing:
            raise ValueError(f"Missing required columns: {sorted(missing)}")

        selected = sensor_column
        if selected is None:
            selected = next((name for name in headers if name.upper().startswith("MQ")), None)
        if selected is None or selected not in headers:
            raise ValueError("No valid MOS gas sensor column was found")

        samples: list[TelemetrySample] = []
        for row_number, row in enumerate(reader, start=2):
            try:
                resistance = float(row[selected])
                if resistance <= 0:
                    raise ValueError("gas resistance must be positive")
                samples.append(
                    TelemetrySample(
                        timestamp=float(row["Minute"]) * 60.0,
                        temperature=float(row["Temperature"]),
                        humidity=float(row["Humidity"]),
                        gas_resistance=resistance,
                        door_open=False,
                    )
                )
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid replay value on CSV row {row_number}: {exc}") from exc
    return samples

"""FoodKeeper data loader with an on-disk cache.

The catalog's ``dop_refrigerate`` interval is converted to its midpoint in
days. The loader accepts the CSV export directly, or downloads and caches it.
"""
import csv
import io
import re
from pathlib import Path

import httpx

DEFAULT_URL = "https://catalog.data.gov/dataset/fsis-foodkeeper-data"


def _midpoint(value: str) -> float | None:
    numbers = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", value or "")]
    if not numbers:
        return None
    return sum(numbers[:2]) / 2 if len(numbers) > 1 else numbers[0]


def load_foodkeeper(source: str | Path, *, cache_path: str | Path | None = None) -> dict[str, float]:
    """Return lowercase food name -> refrigerated midpoint days.

    ``source`` may be a local CSV or the catalog URL. A downloaded response is
    cached before parsing so startup does not require another network request.
    """
    source_path = Path(source) if not str(source).startswith(("http://", "https://")) else None
    if source_path is not None:
        payload = source_path.read_bytes()
    else:
        cache = Path(cache_path) if cache_path else None
        if cache and cache.exists():
            payload = cache.read_bytes()
        else:
            response = httpx.get(str(source), timeout=30.0, follow_redirects=True)
            response.raise_for_status()
            payload = response.content
            if cache:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_bytes(payload)
    text = payload.decode("utf-8-sig", errors="replace")
    rows = csv.DictReader(io.StringIO(text))
    fields = {str(f).strip().lower(): f for f in (rows.fieldnames or [])}
    name_key = next((v for k, v in fields.items() if "food" in k or "item" in k or "name" in k), None)
    cold_key = next((v for k, v in fields.items() if "dop_refrigerate" in k or "refrigerate" in k), None)
    if not name_key or not cold_key:
        raise ValueError("FoodKeeper CSV must contain food name and dop_refrigerate columns")
    result: dict[str, float] = {}
    for row in rows:
        days = _midpoint(row.get(cold_key, ""))
        name = (row.get(name_key) or "").strip().lower()
        if name and days is not None:
            result[name] = days
    return result

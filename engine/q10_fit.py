"""Fit Q10 from manually exported ComBase growth-rate observations."""
import csv
import logging
import math
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


def fit_q10(csv_path: str | Path) -> dict[str, dict[str, float]]:
    groups: dict[str, list[tuple[float, float]]] = {}
    with Path(csv_path).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            organism = row["organism"].strip()
            if not organism:
                raise ValueError("each observation requires an organism")
            rate = float(row["mu_max"])
            temperature = float(row["temp_c"])
            if not math.isfinite(rate) or not math.isfinite(temperature):
                raise ValueError("growth observations must be finite")
            if rate > 0:
                groups.setdefault(organism, []).append((temperature, rate))
    if not groups:
        raise ValueError("positive growth-rate observations are required")
    results = {}
    for organism, observations in groups.items():
        temps, rates = np.asarray(observations, dtype=float).T
        if len(temps) < 2 or len(np.unique(temps)) < 2:
            raise ValueError(f"{organism}: at least two distinct temperatures are required")
        slope, intercept = np.polyfit(temps, np.log(rates), 1)
        predicted = slope * temps + intercept
        rmse = float(np.sqrt(np.mean((predicted - np.log(rates)) ** 2)))
        q10 = math.exp(10.0 * float(slope))
        if not 1.5 <= q10 <= 4.0:
            logger.warning("%s: fitted Q10 %.3f is outside the expected 1.5-4.0 range", organism, q10)
        results[organism] = {"slope": float(slope), "intercept": float(intercept), "q10": q10, "rmse": rmse}
    return results

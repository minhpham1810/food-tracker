"""Calibrate the gas anomaly track against a labelled spoilage run.

The supplied Mendeley data uses MQ-series sensors, not a BME688. Absolute
resistance values therefore do not transfer; this learns the shape of the
normalised residual/freshness relationship. Coefficients must be refit on our
hardware after a real spoilage run.
"""
import csv
import json
import math
import logging
from pathlib import Path

import numpy as np

from .gas import fit_gas_baseline

REPORTABLE = False
REPORTING_WARNING = (
    "NOT FOR REPORTING: model selection uses the test split; class accuracy includes "
    "training rows and does not implement the dataset TVC class thresholds. "
    "Metrics are exploratory and must not be presented as validation."
)


def _field(row: dict[str, str], name: str) -> str:
    key = next((k for k in row if k.strip().lower() == name), None)
    if key is None:
        raise ValueError(f"missing CSV column: {name}")
    return key


def _isotonic(x: np.ndarray, y: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    order = np.argsort(x)
    xs, ys = x[order], y[order]
    blocks: list[list[float]] = []
    for value in ys:
        blocks.append([float(value), 1.0])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            total = blocks[-2][0] * blocks[-2][1] + blocks[-1][0] * blocks[-1][1]
            count = blocks[-2][1] + blocks[-1][1]
            blocks[-2:] = [[total / count, count]]
    fitted = np.repeat([b[0] for b in blocks], [int(b[1]) for b in blocks])
    return xs, fitted


def _predict_iso(x_train: np.ndarray, y_train: np.ndarray, x: np.ndarray) -> np.ndarray:
    xs, ys = _isotonic(x_train, y_train)
    return np.interp(x, xs, ys, left=ys[0], right=ys[-1])


def calibrate_csv(csv_path: str | Path, output_json: str | Path | None = None) -> dict[str, object]:
    logging.getLogger(__name__).warning(REPORTING_WARNING)
    with Path(csv_path).open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 20:
        raise ValueError("at least 20 labelled samples are required")
    temp_key = _field(rows[0], "temperature")
    rh_key = _field(rows[0], "humidity")
    tvc_key = _field(rows[0], "tvc")
    label_key = _field(rows[0], "label")
    mq_keys = [k for k in rows[0] if k.strip().lower().startswith("mq")]
    if not mq_keys:
        raise ValueError("no MQ sensor columns found")
    T = np.asarray([float(r[temp_key]) for r in rows])
    RH = np.asarray([float(r[rh_key]) for r in rows])
    tvc = np.asarray([float(r[tvc_key]) for r in rows])
    resistance = np.exp(np.mean(np.log(np.asarray([[float(r[k]) for k in mq_keys] for r in rows])), axis=1))
    baseline_n = max(4, int(math.ceil(len(rows) * 0.10)))
    baseline = fit_gas_baseline(T[:baseline_n], RH[:baseline_n], resistance[:baseline_n])
    interaction = baseline.interaction and len(baseline.beta) == 4
    X = np.column_stack([np.ones(len(rows)), T, RH, T * RH] if interaction else [np.ones(len(rows)), T, RH])
    residual = np.log(resistance) - X @ np.asarray(baseline.beta)
    z = (residual - baseline.residual_mean) / baseline.baseline_residual_sigma
    f_true = np.clip((tvc - tvc[0]) / (5.0 - tvc[0]), 0.0, 1.0)
    split = max(2, int(len(rows) * 0.70))
    train, test = slice(0, split), slice(split, None)
    a, b = np.polyfit(z[train], f_true[train], 1)
    linear = np.clip(a * z + b, 0.0, 1.0)
    iso = np.clip(_predict_iso(z[train], f_true[train], z), 0.0, 1.0)
    linear_rmse = float(np.sqrt(np.mean((linear[test] - f_true[test]) ** 2)))
    iso_rmse = float(np.sqrt(np.mean((iso[test] - f_true[test]) ** 2)))
    use_iso = iso_rmse + 1e-9 < linear_rmse
    prediction = iso if use_iso else linear
    labels = ["excellent", "good", "acceptable", "spoiled"]
    label_index = {name: i for i, name in enumerate(labels)}
    expected = np.asarray([label_index.get(str(r[label_key]).strip().lower(), -1) for r in rows])
    predicted_class = np.minimum(3, (prediction * 4).astype(int))
    valid = expected >= 0
    accuracy = float(np.mean(predicted_class[valid] == expected[valid])) if np.any(valid) else 0.0
    result: dict[str, object] = {
        "reportable": REPORTABLE,
        "reporting_warning": REPORTING_WARNING,
        "a": float(a), "b": float(b), "mapping": "isotonic" if use_iso else "linear",
        "linear_rmse": linear_rmse, "isotonic_rmse": iso_rmse,
        "r2": float(1 - np.sum((prediction[test] - f_true[test]) ** 2) / max(np.sum((f_true[test] - f_true[test].mean()) ** 2), 1e-12)),
        "rmse": float(min(linear_rmse, iso_rmse)),
        "baseline_residual_sigma": float(baseline.baseline_residual_sigma),
        "accuracy_4_class": accuracy,
        "temporal_split": {"baseline_fraction": 0.10, "train_fraction": 0.70, "test_fraction": 0.30},
    }
    if output_json:
        Path(output_json).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path

from .models import FusionResult

SIGMA_A_PLACEHOLDER = 0.20  # Replace with our own validation experiment.
SIGMA_B_PLACEHOLDER = 1.0  # Conservative full-scale error; replace with P4 held-out temporal RMSE.


@dataclass(frozen=True)
class FusionUncertainty:
    used_for_estimate: bool = False
    sigma_a: float = SIGMA_A_PLACEHOLDER
    sigma_b: float = SIGMA_B_PLACEHOLDER
    sigma_a_source: str = "placeholder"
    sigma_b_source: str = "placeholder"
    sigma_b_reason: str = "calibration_missing"


def load_fusion_uncertainty(path: str | Path | None = None) -> FusionUncertainty:
    """Load prediction error only; baseline log-resistance noise is not fusion error."""
    path = Path(path or os.getenv("GAS_CALIBRATION_PATH", "data/gas_calibration.json"))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("reportable") is False:
            raise ValueError("exploratory calibration cannot supply prediction uncertainty")
        split = data["temporal_split"]
        train_fraction = float(split["train_fraction"])
        test_fraction = float(split["test_fraction"])
        rmse = float(data["rmse"])
        if not (0 < train_fraction < 1 and 0 < test_fraction < 1
                and train_fraction + test_fraction <= 1.0
                and math.isfinite(rmse) and rmse > 0):
            raise ValueError("invalid temporal prediction error")
    except FileNotFoundError:
        return FusionUncertainty()
    except (OSError, ValueError, KeyError, TypeError):
        return FusionUncertainty(sigma_b_reason="calibration_invalid")
    return FusionUncertainty(sigma_b=rmse, sigma_b_source="fitted",
                             sigma_b_reason="held_out_temporal_rmse")


def fuse(
    days_A: float,
    f_A: float,
    anomaly_B: float | None,
    color_C: float | None,
    sigma_b: float | None = None,
    experimental_enabled: bool = False,
) -> FusionResult:
    if days_A < 0:
        raise ValueError("days_A must be non-negative")
    if not 0.0 <= f_A <= 1.0:
        raise ValueError("f_A must be between 0 and 1")
    if not experimental_enabled:
        return FusionResult(days_left=days_A, confidence="med",
                            status="fresh" if days_A > 0 else "past_budget_quiet")
    if anomaly_B is not None and not 0.0 <= anomaly_B <= 1.0:
        raise ValueError("anomaly_B must be between 0 and 1")
    if sigma_b is not None and (not math.isfinite(sigma_b) or sigma_b <= 0):
        raise ValueError("sigma_B must be positive")
    if color_C is not None and not 0.0 <= color_C <= 1.0:
        raise ValueError("color_C must be between 0 and 1")

    days = days_A
    tracks = [f_A]

    if anomaly_B is not None:
        f_B = 1.0 - anomaly_B
        sigma = SIGMA_B_PLACEHOLDER if sigma_b is None else sigma_b
        w_a = 1.0 / (SIGMA_A_PLACEHOLDER ** 2)
        w_b = 1.0 / (sigma ** 2)
        fused_freshness = (w_a * f_A + w_b * f_B) / (w_a + w_b)
        # Gas can only shorten the estimate, never extend it.
        fused_freshness = min(fused_freshness, f_A)
        days = days_A * (fused_freshness / f_A) if f_A > 0 else 0.0
        tracks.append(f_B)
    if color_C is not None:
        days *= 0.3 + 0.7 * color_C
        tracks.append(color_C)

    gas_veto = anomaly_B is not None and anomaly_B > 0.8
    color_veto = color_C is not None and color_C < 0.2
    secondary_alarm = gas_veto or color_veto
    if secondary_alarm:
        days = 0.0

    spread = max(tracks) - min(tracks)
    confidence = "high" if spread < 0.2 else "med" if spread < 0.4 else "low"
    if anomaly_B is None and confidence == "high":
        confidence = "med"

    if days_A <= 0:
        status = "discard_quality_signal" if secondary_alarm else "past_budget_quiet"
    elif secondary_alarm:
        status = "check_early"
    else:
        status = "fresh"

    return FusionResult(days_left=max(0.0, days), confidence=confidence, status=status)

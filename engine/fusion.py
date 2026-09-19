from .models import FusionResult


def fuse(
    days_A: float,
    f_A: float,
    anomaly_B: float | None,
    color_C: float | None,
) -> FusionResult:
    if days_A < 0:
        raise ValueError("days_A must be non-negative")
    if not 0.0 <= f_A <= 1.0:
        raise ValueError("f_A must be between 0 and 1")
    if anomaly_B is not None and not 0.0 <= anomaly_B <= 1.0:
        raise ValueError("anomaly_B must be between 0 and 1")
    if color_C is not None and not 0.0 <= color_C <= 1.0:
        raise ValueError("color_C must be between 0 and 1")

    days = days_A
    tracks = [f_A]

    if anomaly_B is not None:
        days *= 1.0 - 0.5 * anomaly_B
        tracks.append(1.0 - anomaly_B)
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

    if days_A <= 0:
        status = "discard_quality_signal" if secondary_alarm else "past_budget_quiet"
    elif secondary_alarm:
        status = "check_early"
    else:
        status = "fresh"

    return FusionResult(days_left=max(0.0, days), confidence=confidence, status=status)

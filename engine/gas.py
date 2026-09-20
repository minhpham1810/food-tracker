import numpy as np
import logging

from .models import GasBaseline
from .config import GasBaselineConfig, gas_baseline_config

logger = logging.getLogger(__name__)


def _design_matrix(T: np.ndarray, RH: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones_like(T), T, RH, T * RH])


def _reduced_matrix(T: np.ndarray, RH: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones_like(T), T, RH])


def fit_gas_baseline(T, RH, R, config: GasBaselineConfig | None = None) -> GasBaseline:
    config = config or gas_baseline_config()
    T = np.asarray(T, dtype=float)
    RH = np.asarray(RH, dtype=float)
    R = np.asarray(R, dtype=float)
    if T.shape != RH.shape or T.shape != R.shape:
        raise ValueError("T, RH, and R must have matching shapes")
    if R.size == 0:
        raise ValueError("at least one gas sample is required")
    if np.any(R <= 0):
        raise ValueError("gas resistance values must be positive")

    # Near-constant predictors cannot identify the interaction term.
    use_interaction = float(np.std(RH)) >= config.min_rh_std and float(np.std(T)) >= config.min_temperature_std
    X = _design_matrix(T, RH)
    condition_number = float(np.linalg.cond(X))
    if condition_number > config.max_condition_number:
        logger.warning("gas baseline design condition number %.3g exceeds %.3g; using reduced model", condition_number, config.max_condition_number)
        use_interaction = False
    if not use_interaction:
        X = _reduced_matrix(T, RH)
        condition_number = float(np.linalg.cond(X))
    beta, *_ = np.linalg.lstsq(X, np.log(R), rcond=None)
    resid = np.log(R) - X @ beta
    std = max(float(resid.std()), 1e-6)
    target = np.log(R)
    total = float(np.sum((target - target.mean()) ** 2))
    r2 = 1.0 - float(np.sum(resid ** 2)) / total if total > 0 else 0.0
    return GasBaseline(
        beta=tuple(float(x) for x in beta),
        residual_mean=float(resid.mean()),
        baseline_residual_sigma=std,
        r2=r2,
        condition_number=condition_number,
        interaction=use_interaction,
    )


def gas_anomaly(T, RH, R, baseline: GasBaseline) -> np.ndarray:
    T = np.asarray(T, dtype=float)
    RH = np.asarray(RH, dtype=float)
    R = np.asarray(R, dtype=float)
    if T.shape != RH.shape or T.shape != R.shape:
        raise ValueError("T, RH, and R must have matching shapes")
    if np.any(R <= 0):
        raise ValueError("gas resistance values must be positive")

    X = _design_matrix(T, RH) if baseline.interaction and len(baseline.beta) == 4 else _reduced_matrix(T, RH)
    eps = np.log(R) - X @ np.asarray(baseline.beta, dtype=float)
    z = (eps - baseline.residual_mean) / baseline.baseline_residual_sigma
    return np.clip(-z / 3.0, 0.0, 1.0)

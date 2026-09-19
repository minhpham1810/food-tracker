import numpy as np

from .models import GasBaseline


def _design_matrix(T: np.ndarray, RH: np.ndarray) -> np.ndarray:
    return np.column_stack([np.ones_like(T), T, RH, T * RH])


def fit_gas_baseline(T, RH, R) -> GasBaseline:
    T = np.asarray(T, dtype=float)
    RH = np.asarray(RH, dtype=float)
    R = np.asarray(R, dtype=float)
    if T.shape != RH.shape or T.shape != R.shape:
        raise ValueError("T, RH, and R must have matching shapes")
    if R.size == 0:
        raise ValueError("at least one gas sample is required")
    if np.any(R <= 0):
        raise ValueError("gas resistance values must be positive")

    X = _design_matrix(T, RH)
    beta, *_ = np.linalg.lstsq(X, np.log(R), rcond=None)
    resid = np.log(R) - X @ beta
    std = max(float(resid.std()), 1e-6)
    return GasBaseline(
        beta=tuple(float(x) for x in beta),
        residual_mean=float(resid.mean()),
        residual_std=std,
    )


def gas_anomaly(T, RH, R, baseline: GasBaseline) -> np.ndarray:
    T = np.asarray(T, dtype=float)
    RH = np.asarray(RH, dtype=float)
    R = np.asarray(R, dtype=float)
    if T.shape != RH.shape or T.shape != R.shape:
        raise ValueError("T, RH, and R must have matching shapes")
    if np.any(R <= 0):
        raise ValueError("gas resistance values must be positive")

    X = _design_matrix(T, RH)
    eps = np.log(R) - X @ np.asarray(baseline.beta, dtype=float)
    z = (eps - baseline.residual_mean) / baseline.residual_std
    return np.clip(-z / 3.0, 0.0, 1.0)

import numpy as np
import pytest
from engine.gas import fit_gas_baseline, gas_anomaly


def test_negative_log_resistance_residual_increases_anomaly():
    T = np.array([4., 5., 6., 7., 8., 9.])
    RH = np.array([60., 61., 62., 63., 64., 65.])
    R = np.array([200000., 198000., 196000., 194000., 192000., 190000.])
    baseline = fit_gas_baseline(T, RH, R)
    normal = gas_anomaly(np.array([8.]), np.array([64.]), np.array([192000.]), baseline)[0]
    reduced = gas_anomaly(np.array([8.]), np.array([64.]), np.array([120000.]), baseline)[0]
    assert 0.0 <= normal <= 1.0
    assert reduced > normal


def test_non_positive_resistance_is_rejected():
    with pytest.raises(ValueError):
        fit_gas_baseline(np.array([4.]), np.array([60.]), np.array([0.]))


def test_near_constant_predictors_select_reduced_model():
    T = np.full(600, 4.0) + np.linspace(-0.05, 0.05, 600)
    RH = np.full(600, 60.0) + np.linspace(-0.2, 0.2, 600)
    R = np.full(600, 200000.0) * np.exp(np.linspace(-0.01, 0.01, 600))
    baseline = fit_gas_baseline(T, RH, R)
    assert baseline.interaction is False
    assert len(baseline.beta) == 3
    assert baseline.r2 >= 0.0
    assert baseline.baseline_residual_sigma > 0

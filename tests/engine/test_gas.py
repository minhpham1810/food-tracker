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

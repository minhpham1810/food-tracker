import pytest
from engine.burn import days_left, freshness_fraction, rate_multiplier, update_budget


def test_rate_multiplier_is_one_at_reference_temperature():
    assert rate_multiplier(4.0, 2.5) == pytest.approx(1.0)


def test_warmer_temperature_burns_faster():
    assert rate_multiplier(22.0, 2.5) > rate_multiplier(8.0, 2.5) > 1.0


def test_budget_never_decreases_and_days_never_negative():
    after = update_budget(1.0, 22.0, 1.0, 2.5)
    assert after > 1.0
    assert days_left(50.0, 10.0, 4.0, 2.5) == 0.0


def test_freshness_fraction_is_clamped():
    assert freshness_fraction(0.0, 10.0) == 1.0
    assert freshness_fraction(20.0, 10.0) == 0.0

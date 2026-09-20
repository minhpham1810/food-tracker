import pytest
from engine.burn import (days_left, freshness_fraction, rate_multiplier, update_budget,
                         current_aging_rate)


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


def test_current_aging_rate_matches_q10_curve():
    # 4C is the reference: unity by definition.
    assert current_aging_rate(4.0, 2.7) == pytest.approx(1.0)
    assert current_aging_rate(12.0, 2.7) == pytest.approx(2.7 ** 0.8)
    assert current_aging_rate(22.0, 2.7) == pytest.approx(2.7 ** 1.8)
    # Colder than the reference slows aging below 1.0x.
    assert current_aging_rate(0.0, 2.7) < 1.0


@pytest.mark.parametrize("temperature", [None, -1.1, 25.1, 40.0])
def test_current_aging_rate_is_none_when_it_cannot_be_stated(temperature):
    """Unusable input yields None, never a reassuring 1.0x."""
    assert current_aging_rate(temperature, 2.7) is None

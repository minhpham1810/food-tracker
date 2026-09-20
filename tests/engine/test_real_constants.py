import json
import pytest

from engine.foodkeeper import load_foodkeeper
from engine.q10_fit import fit_q10
from engine.profiles import load_profiles


def test_profiles_mark_constant_source():
    profiles = load_profiles()
    assert {key for key, profile in profiles.items() if profile.source == "usda-fsis"} == {
        "red_meat", "poultry", "seafood", "dairy", "eggs"
    }
    assert {key for key, profile in profiles.items() if profile.source == "placeholder"} == {
        "leafy_greens", "vegetables", "fruit", "leftovers"
    }
    for key in ("red_meat", "poultry", "seafood", "dairy"):
        assert profiles[key].q10 == 2.7
        assert profiles[key].q10_source == "fitted-published-multitemp"
    assert profiles["dairy"].d0_days == 6.0
    assert profiles["dairy"].opened_d0_days == 4.0


def test_foodkeeper_midpoint_and_q10_fit(tmp_path):
    food = tmp_path / "food.csv"
    food.write_text("Food Name,dop_refrigerate\nMilk,7-10 days\n", encoding="utf-8")
    assert load_foodkeeper(food)["milk"] == 8.5
    observations = tmp_path / "comb.csv"
    observations.write_text("organism,temp_c,mu_max\nA,0,1\nA,10,2\n", encoding="utf-8")
    result = fit_q10(observations)["A"]
    assert result["q10"] == pytest.approx(2.0)
    assert result["rmse"] == pytest.approx(0.0)


def test_q10_keeps_organisms_separate(tmp_path):
    observations = tmp_path / 'grouped.csv'
    observations.write_text('organism,temp_c,mu_max\nA,0,1\nB,0,1\nA,10,2\nB,10,3\n')
    result = fit_q10(observations)
    assert result['A']['q10'] == pytest.approx(2)
    assert result['B']['q10'] == pytest.approx(3)


def test_exploratory_gas_calibration_is_explicitly_not_reportable():
    from engine.gas_calibrate import REPORTABLE, REPORTING_WARNING
    assert REPORTABLE is False
    assert 'NOT FOR REPORTING' in REPORTING_WARNING

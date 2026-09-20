import json

import pytest

from apps.api.schemas import AppStateOut
from apps.api.service import FreshnessService
from engine.fusion import SIGMA_A_PLACEHOLDER, SIGMA_B_PLACEHOLDER, fuse
from engine.models import GasBaseline
from dataclasses import asdict


def test_missing_calibration_exposes_placeholders_and_ignores_baseline_noise(tmp_path):
    service = FreshnessService(seed_hero_items=False, calibration_path=str(tmp_path / "missing.json"), experimental_fusion=True)
    item = service.add_item("dairy")
    service.store.gas_baseline = GasBaseline((0, 0, 0), 0, 1e-6, interaction=False)
    state = service._item_state(service.store.items[item.id], gas_score=0.5)
    assert state.days_left == fuse(state.track_a_days_left, state.freshness_fraction,
                                   0.5, None, SIGMA_B_PLACEHOLDER, experimental_enabled=True).days_left
    api = AppStateOut(**asdict(service.snapshot())).model_dump()
    uncertainty = api["items"][0]["fusion_uncertainty"]
    assert uncertainty["sigma_a"] == SIGMA_A_PLACEHOLDER
    assert uncertainty["sigma_b"] == SIGMA_B_PLACEHOLDER
    assert uncertainty["sigma_a_source"] == uncertainty["sigma_b_source"] == "placeholder"
    assert uncertainty["sigma_b_reason"] == "calibration_missing"
    assert api["telemetry"]["baseline_residual_sigma"] == 1e-6


def test_loads_held_out_rmse_instead_of_baseline_sigma(tmp_path):
    artifact = tmp_path / "calibration.json"
    artifact.write_text(json.dumps({"rmse": 0.37, "baseline_residual_sigma": 0.00001,
        "temporal_split": {"train_fraction": 0.7, "test_fraction": 0.3}}))
    service = FreshnessService(seed_hero_items=False, calibration_path=str(artifact), experimental_fusion=True)
    item = service.add_item("dairy")
    state = service._item_state(service.store.items[item.id], gas_score=0.5)
    assert state.fusion_uncertainty.sigma_b == 0.37
    assert state.fusion_uncertainty.sigma_b_source == "fitted"
    assert state.fusion_uncertainty.sigma_a_source == "placeholder"
    assert state.days_left == fuse(state.track_a_days_left, state.freshness_fraction, 0.5, None, 0.37, experimental_enabled=True).days_left


@pytest.mark.parametrize("payload", ["broken", "{}", '{"rmse": 0.1}',
    '{"rmse": -1, "temporal_split": {"train_fraction": 0.7, "test_fraction": 0.3}}'])
def test_invalid_artifact_reports_placeholder(tmp_path, payload):
    artifact = tmp_path / "calibration.json"
    artifact.write_text(payload)
    service = FreshnessService(seed_hero_items=False, calibration_path=str(artifact), experimental_fusion=True)
    assert service.fusion_uncertainty.sigma_b == SIGMA_B_PLACEHOLDER
    assert service.fusion_uncertainty.sigma_b_reason == "calibration_invalid"

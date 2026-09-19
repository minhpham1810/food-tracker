import pytest
from fastapi.testclient import TestClient

from apps.api import main
from apps.api.service import FreshnessService
from simulator.sensor_sim import SensorSimulator


@pytest.fixture
def client(monkeypatch, tmp_path):
    service = FreshnessService()
    monkeypatch.setattr(main, "service", service)
    monkeypatch.setattr(
        main, "simulator",
        SensorSimulator(service.ingest, service.reset_demo_state, service.store),
    )
    monkeypatch.setenv("FRESHNESS_DATA_DIR", str(tmp_path))
    with TestClient(main.app) as session:
        yield session


def test_replay_uses_inventory_ingestion(client, tmp_path):
    (tmp_path / "beef.csv").write_text(
        "Minute,MQ135,Temperature,Humidity\n"
        "0,200000,4,60\n60,200000,22,60\n",
        encoding="utf-8",
    )
    response = client.post("/api/demo/replay", json={"path": "beef.csv"})
    assert response.status_code == 200
    state = response.json()
    assert state["telemetry"]["timestamp"] == 3600
    assert all(item["t_eff"] > 0 for item in state["items"])
    assert state["active_scenario"] is None
    assert state["telemetry_paused"] is True


def test_replay_rejects_paths_outside_data_directory(client, tmp_path):
    for path in ("../outside.csv", str(tmp_path.parent / "outside.csv")):
        response = client.post("/api/demo/replay", json={"path": path})
        assert response.status_code == 400
        assert "inside FRESHNESS_DATA_DIR" in response.json()["detail"]


def test_invalid_replay_preserves_inventory_state(client, tmp_path):
    before = client.get("/api/state").json()
    (tmp_path / "bad.csv").write_text("wrong,columns\n1,2\n", encoding="utf-8")
    assert client.post("/api/demo/replay", json={"path": "bad.csv"}).status_code == 400
    assert client.post("/api/demo/replay", json={"path": "missing.csv"}).status_code == 404
    assert client.get("/api/state").json() == before

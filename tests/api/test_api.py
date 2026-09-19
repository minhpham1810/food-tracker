from fastapi.testclient import TestClient
from apps.api.main import app

client = TestClient(app)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_valid_telemetry_is_accepted():
    response = client.post("/api/telemetry", json={
        "timestamp": 1788138000,
        "temperature": 4.2,
        "humidity": 61.5,
        "gas_resistance": 184230,
        "door_open": False,
    })
    assert response.status_code == 200


def test_missing_or_invalid_telemetry_is_rejected():
    assert client.post("/api/telemetry", json={"temperature": 4.0}).status_code == 422
    payload = {
        "timestamp": 1,
        "temperature": 4.0,
        "humidity": 130,
        "gas_resistance": 1000,
        "door_open": False,
    }
    assert client.post("/api/telemetry", json=payload).status_code == 422


def test_item_add_open_and_label_score_routes():
    created = client.post("/api/items", json={"profile_id": "milk", "name": "Demo milk"})
    assert created.status_code == 201
    item_id = created.json()["id"]
    assert client.post(f"/api/items/{item_id}/opened").status_code == 200
    score = client.post(f"/api/items/{item_id}/label-score", json={"score": 0.5})
    assert score.status_code == 200
    assert score.json()["color_score"] == 0.5


def test_get_rename_and_recategorize_item_routes():
    created = client.post("/api/items", json={"profile_id": "milk", "name": "Demo milk"})
    item_id = created.json()["id"]

    fetched = client.get(f"/api/items/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Demo milk"

    renamed = client.post(f"/api/items/{item_id}/rename", json={"name": "Leftover milk"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Leftover milk"

    recategorized = client.post(f"/api/items/{item_id}/category", json={"profile_id": "chicken"})
    assert recategorized.status_code == 200
    assert recategorized.json()["profile_id"] == "chicken"

    assert client.get("/api/items/does-not-exist").status_code == 404
    assert client.post(f"/api/items/{item_id}/category", json={"profile_id": "made-up"}).status_code == 400


def test_unknown_profile_and_invalid_label_score_are_rejected():
    assert client.post("/api/items", json={"profile_id": "made-up"}).status_code == 400
    items = client.get("/api/items").json()
    item_id = items[0]["id"]
    assert client.post(f"/api/items/{item_id}/label-score", json={"score": 2}).status_code == 422


def test_demo_lifecycle_endpoints():
    assert client.post("/api/demo/scenarios/hot_car/start").status_code == 200
    assert client.post("/api/demo/stop").status_code == 200
    assert client.post("/api/demo/reset").status_code == 200
    assert client.post("/api/demo/scenarios/not-real/start").status_code == 404


def test_profiles_endpoint_exposes_the_food_catalog():
    response = client.get("/api/profiles")
    assert response.status_code == 200
    profiles = response.json()

    ids = {profile["id"] for profile in profiles}
    assert {"milk", "chicken", "spinach"} <= ids

    milk = next(profile for profile in profiles if profile["id"] == "milk")
    assert milk["name"] == "Milk"
    assert milk["d0_days"] > milk["opened_d0_days"]
    assert milk["q10"] > 0
    # These coefficients are hackathon placeholders; the flag must survive to clients
    # so the UI can label them as such.
    assert milk["placeholder"] is True


def test_delete_item_removes_it_and_clears_its_alerts():
    created = client.post("/api/items", json={"profile_id": "milk", "name": "Doomed carton"})
    item_id = created.json()["id"]
    assert any(item["id"] == item_id for item in client.get("/api/items").json())

    assert client.delete(f"/api/items/{item_id}").status_code == 204
    assert all(item["id"] != item_id for item in client.get("/api/items").json())
    assert client.get(f"/api/items/{item_id}").status_code == 404

    # Alerts are keyed by item id; a deleted item must not leave one behind.
    codes = {alert["code"] for alert in client.get("/api/state").json()["alerts"]}
    assert f"critical_{item_id}" not in codes

    assert client.delete(f"/api/items/{item_id}").status_code == 404


def test_assistant_endpoint_returns_502_when_local_llm_is_unreachable(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient

    from apps.api.main import app, llm_gateway

    def boom(messages):
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(llm_gateway, "_chat", boom)
    client = TestClient(app)
    response = client.post("/api/assistant/message", json={"message": "hello"})
    assert response.status_code == 502

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
    created = client.post("/api/items", json={"profile_id": "dairy", "name": "Demo milk"})
    assert created.status_code == 201
    item_id = created.json()["id"]
    assert client.post(f"/api/items/{item_id}/opened").status_code == 200
    score = client.post(f"/api/items/{item_id}/label-score", json={"score": 0.5})
    assert score.status_code == 200
    assert score.json()["color_score"] == 0.5


def test_get_rename_and_recategorize_item_routes():
    created = client.post("/api/items", json={"profile_id": "dairy", "name": "Demo milk"})
    item_id = created.json()["id"]

    fetched = client.get(f"/api/items/{item_id}")
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Demo milk"

    renamed = client.post(f"/api/items/{item_id}/rename", json={"name": "Leftover milk"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Leftover milk"

    recategorized = client.post(f"/api/items/{item_id}/category", json={"profile_id": "poultry"})
    assert recategorized.status_code == 200
    assert recategorized.json()["profile_id"] == "poultry"

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
    assert {"dairy", "poultry", "leafy_greens"} <= ids

    dairy = next(profile for profile in profiles if profile["id"] == "dairy")
    assert dairy["name"] == "Dairy"
    assert dairy["d0_days"] > dairy["opened_d0_days"]
    assert dairy["q10"] > 0
    # These coefficients are hackathon placeholders; the flag must survive to clients
    # so the UI can label them as such.
    assert dairy["placeholder"] is True


def test_delete_item_removes_it_and_clears_its_alerts():
    created = client.post("/api/items", json={"profile_id": "dairy", "name": "Doomed carton"})
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


def test_scan_photo_becomes_the_item_thumbnail():
    import io

    from PIL import Image

    from apps.api.main import service
    from apps.api.ocr import thumbnail

    source = io.BytesIO()
    Image.new("RGB", (1800, 1200), (120, 40, 40)).save(source, format="PNG")
    # The scan route is not called here: it needs a vision model. It hands the
    # same thumbnail to the same stash.
    scan_id = service.stash_scan_photo(thumbnail(source.getvalue()))

    created = client.post(
        "/api/ocr/confirm", json={"profile_id": "dairy", "name": "Scanned milk", "scan_id": scan_id, "category_confirmed": True}
    )
    assert created.status_code == 201
    item_id = created.json()["id"]
    assert created.json()["has_photo"] is True

    photo = client.get(f"/api/items/{item_id}/photo")
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/jpeg"
    stored = Image.open(io.BytesIO(photo.content))
    assert max(stored.size) == 512

    # A scan id is single-use, so a second confirm cannot adopt the same photo.
    again = client.post("/api/ocr/confirm", json={"profile_id": "dairy", "scan_id": scan_id, "category_confirmed": True})
    assert again.json()["has_photo"] is False

    manual = client.post("/api/items", json={"profile_id": "dairy", "name": "Typed in"})
    assert manual.json()["has_photo"] is False
    assert client.get(f"/api/items/{manual.json()['id']}/photo").status_code == 404

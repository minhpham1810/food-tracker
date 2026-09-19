import pytest


@pytest.fixture(autouse=True)
def no_live_thingspeak(monkeypatch):
    """apps/api/config.py loads .env, which may name a real channel. An empty
    value wins over .env, so TestClient startups never poll the network."""
    monkeypatch.setenv("THINGSPEAK_CHANNEL_ID", "")

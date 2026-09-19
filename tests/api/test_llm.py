import pytest

from apps.api.llm.gateway import LLMGateway
from apps.api.llm.tools import ToolDispatcher
from apps.api.service import FreshnessService


def make_dispatcher():
    service = FreshnessService(seed_hero_items=False)
    item = service.add_item("dairy")
    return ToolDispatcher(service), item.id


def test_gateway_defaults_to_ollama(monkeypatch):
    for name in (
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_API_KEY",
        "OMLX_BASE_URL",
        "OMLX_MODEL",
        "OMLX_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    dispatcher, _ = make_dispatcher()
    gateway = LLMGateway(dispatcher)

    assert gateway.base_url == "http://127.0.0.1:11434/v1"
    assert gateway.model == "qwen3.5:9b"
    assert gateway.api_key == ""


def test_gateway_prefers_llm_variables_and_supports_legacy_aliases(monkeypatch):
    dispatcher, _ = make_dispatcher()
    monkeypatch.setenv("OMLX_BASE_URL", "http://legacy.test/v1")
    monkeypatch.setenv("OMLX_MODEL", "legacy-model")
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)

    legacy = LLMGateway(dispatcher)
    assert legacy.base_url == "http://legacy.test/v1"
    assert legacy.model == "legacy-model"

    monkeypatch.setenv("LLM_BASE_URL", "http://preferred.test/v1/")
    monkeypatch.setenv("LLM_MODEL", "preferred-model")
    preferred = LLMGateway(dispatcher)
    assert preferred.base_url == "http://preferred.test/v1"
    assert preferred.model == "preferred-model"


def test_dispatcher_rejects_unknown_tool():
    dispatcher, _ = make_dispatcher()
    with pytest.raises(ValueError):
        dispatcher.call("delete_everything", {})


def test_dispatcher_get_items_lists_summaries():
    dispatcher, item_id = make_dispatcher()
    result = dispatcher.call("get_items", {})
    assert any(entry["id"] == item_id for entry in result["items"])


def test_dispatcher_mark_item_opened_shortens_budget():
    dispatcher, item_id = make_dispatcher()
    before = dispatcher.call("get_item_freshness", {"item_id": item_id})
    after = dispatcher.call("mark_item_opened", {"item_id": item_id})
    assert after["opened"] is True
    assert after["days_left"] <= before["days_left"]


def test_dispatcher_rename_and_recategorize():
    dispatcher, item_id = make_dispatcher()
    renamed = dispatcher.call("rename_item", {"item_id": item_id, "name": "Opened milk"})
    assert renamed["name"] == "Opened milk"
    recategorized = dispatcher.call("set_food_category", {"item_id": item_id, "profile_id": "poultry"})
    assert recategorized["profile_id"] == "poultry"


def test_dispatcher_missing_item_id_argument_raises():
    dispatcher, _ = make_dispatcher()
    with pytest.raises(ValueError):
        dispatcher.call("mark_item_opened", {})


def test_dispatcher_unknown_item_raises_key_error():
    dispatcher, _ = make_dispatcher()
    with pytest.raises(KeyError):
        dispatcher.call("get_item_freshness", {"item_id": "does-not-exist"})


def _tool_call_message(name: str, arguments: str, call_id: str = "call_1") -> dict:
    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {"id": call_id, "type": "function", "function": {"name": name, "arguments": arguments}}
        ],
    }


def test_gateway_executes_a_tool_call_then_returns_final_reply(monkeypatch):
    dispatcher, item_id = make_dispatcher()
    gateway = LLMGateway(dispatcher, api_key="test-key")

    responses = [
        _tool_call_message("mark_item_opened", f'{{"item_id": "{item_id}"}}'),
        {"role": "assistant", "content": "Done, I marked the milk as opened.", "tool_calls": []},
    ]

    def fake_chat(messages):
        return responses.pop(0)

    monkeypatch.setattr(gateway, "_chat", fake_chat)

    result = gateway.converse("I opened the milk")
    assert result["reply"] == "Done, I marked the milk as opened."
    assert len(result["tool_calls"]) == 1
    assert result["tool_calls"][0]["name"] == "mark_item_opened"
    assert result["tool_calls"][0]["result"]["opened"] is True


def test_gateway_surfaces_tool_errors_without_raising(monkeypatch):
    dispatcher, _ = make_dispatcher()
    gateway = LLMGateway(dispatcher)

    responses = [
        _tool_call_message("mark_item_opened", '{"item_id": "nope"}'),
        {"role": "assistant", "content": "That item doesn't exist.", "tool_calls": []},
    ]
    monkeypatch.setattr(gateway, "_chat", lambda messages: responses.pop(0))

    result = gateway.converse("open item nope")
    assert "error" in result["tool_calls"][0]["result"]


def test_gateway_stops_after_max_tool_rounds(monkeypatch):
    dispatcher, item_id = make_dispatcher()
    gateway = LLMGateway(dispatcher)
    monkeypatch.setattr(
        gateway,
        "_chat",
        lambda messages: _tool_call_message("get_item_freshness", f'{{"item_id": "{item_id}"}}'),
    )

    result = gateway.converse("loop forever", max_tool_rounds=2)
    assert result["reply"] == "I couldn't finish that within the tool-call budget."
    assert len(result["tool_calls"]) == 2

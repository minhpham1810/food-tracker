"""Client for a local OpenAI-compatible tool-calling API.

This project defaults to Ollama. Other compatible servers remain supported, and
the older OMLX_* environment variable names are retained as fallbacks.
"""

from __future__ import annotations

import json

import httpx

from ..config import env_with_fallback
from .tools import TOOL_SCHEMAS, ToolDispatcher

DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1"
DEFAULT_MODEL = "qwen3.5:9b"

SYSTEM_PROMPT = (
    "You are the Freshness Tracker fridge assistant. You can only observe and change "
    "fridge state through the tools you are given. The freshness engine (Track A/B/C "
    "fusion) is the sole source of days_left, freshness_fraction, status and confidence "
    "-- never invent, restate from memory, or recompute those numbers yourself; always "
    "read them from a tool result. Keep replies short and concrete."
)


class LLMGateway:
    def __init__(
        self,
        dispatcher: ToolDispatcher,
        *,
        base_url: str | None = None,
        model: str | None = None,
        api_key: str | None = None,
        timeout: float = 120.0,
    ):
        self.dispatcher = dispatcher
        self.base_url = (
            base_url or env_with_fallback("LLM_BASE_URL", "OMLX_BASE_URL", DEFAULT_BASE_URL)
        ).rstrip("/")
        self.model = model or env_with_fallback("LLM_MODEL", "OMLX_MODEL", DEFAULT_MODEL)
        self.api_key = (
            api_key
            if api_key is not None
            else env_with_fallback("LLM_API_KEY", "OMLX_API_KEY", "")
        )
        self.timeout = timeout

    def converse(self, user_message: str, max_tool_rounds: int = 4) -> dict:
        messages: list[dict] = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ]
        tool_calls_made: list[dict] = []
        for _ in range(max_tool_rounds):
            choice = self._chat(messages)
            tool_calls = choice.get("tool_calls") or []
            if not tool_calls:
                return {"reply": choice.get("content") or "", "tool_calls": tool_calls_made}

            messages.append(
                {
                    "role": "assistant",
                    "content": choice.get("content"),
                    "tool_calls": tool_calls,
                }
            )
            for call in tool_calls:
                fn = call.get("function", {})
                name = fn.get("name", "")
                try:
                    arguments = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                try:
                    result = self.dispatcher.call(name, arguments)
                except (KeyError, ValueError) as exc:
                    result = {"error": str(exc)}
                tool_calls_made.append({"name": name, "arguments": arguments, "result": result})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.get("id", ""),
                        "content": json.dumps(result, default=str),
                    }
                )

        return {
            "reply": "I couldn't finish that within the tool-call budget.",
            "tool_calls": tool_calls_made,
        }

    def _chat(self, messages: list[dict]) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        response = httpx.post(
            f"{self.base_url}/chat/completions",
            headers=headers,
            timeout=self.timeout,
            json={
                "model": self.model,
                "messages": messages,
                "tools": TOOL_SCHEMAS,
                "tool_choice": "auto",
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]

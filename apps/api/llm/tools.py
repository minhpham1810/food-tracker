"""Tool contract between the local LLM and FreshnessService.

The model only ever *requests* an action by name and arguments; ToolDispatcher is what
actually validates and executes it against the service. The model never writes
days_left/status/confidence itself -- those stay owned by engine/fusion.py.
"""

from ..service import FreshnessService, ItemState

TOOL_SCHEMAS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "get_items",
            "description": "List every tracked fridge item with its current freshness status.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_item_freshness",
            "description": "Get the detailed freshness state for one item by id.",
            "parameters": {
                "type": "object",
                "properties": {"item_id": {"type": "string", "description": "Item id from get_items"}},
                "required": ["item_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_fridge_status",
            "description": (
                "Get the latest telemetry reading (temperature, humidity, gas) "
                "and any active alerts."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_item_opened",
            "description": (
                "Mark an item as opened. This can only shorten its remaining freshness "
                "budget, never extend it."
            ),
            "parameters": {
                "type": "object",
                "properties": {"item_id": {"type": "string"}},
                "required": ["item_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rename_item",
            "description": "Rename a tracked item's display name. Does not affect freshness.",
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "string"},
                    "name": {"type": "string"},
                },
                "required": ["item_id", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "set_food_category",
            "description": (
                "Recategorize an item to a different known food profile, e.g. to correct a "
                "misidentified item. Changes which Track A burn-down curve applies."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "item_id": {"type": "string"},
                    "profile_id": {
                        "type": "string",
                        "description": "A known food category id, e.g. dairy, poultry, red_meat, vegetables",
                    },
                },
                "required": ["item_id", "profile_id"],
            },
        },
    },
]


class ToolDispatcher:
    def __init__(self, service: FreshnessService):
        self.service = service

    def call(self, name: str, arguments: dict) -> dict:
        handler = getattr(self, f"_tool_{name}", None)
        if handler is None:
            raise ValueError(f"Unknown tool: {name}")
        return handler(arguments)

    def _tool_get_items(self, arguments: dict) -> dict:
        return {"items": [_item_summary(item) for item in self.service.snapshot().items]}

    def _tool_get_item_freshness(self, arguments: dict) -> dict:
        item_id = _require_str(arguments, "item_id")
        return _item_summary(self.service.get_item(item_id))

    def _tool_get_fridge_status(self, arguments: dict) -> dict:
        state = self.service.snapshot()
        return {
            "telemetry": {
                "temperature": state.telemetry.temperature,
                "humidity": state.telemetry.humidity,
                "gas_resistance": state.telemetry.gas_resistance,
            },
            "alerts": [
                {"code": alert.code, "message": alert.message, "severity": alert.severity}
                for alert in state.alerts
            ],
        }

    def _tool_mark_item_opened(self, arguments: dict) -> dict:
        item_id = _require_str(arguments, "item_id")
        return _item_summary(self.service.mark_opened(item_id))

    def _tool_rename_item(self, arguments: dict) -> dict:
        item_id = _require_str(arguments, "item_id")
        name = _require_str(arguments, "name")
        return _item_summary(self.service.rename_item(item_id, name))

    def _tool_set_food_category(self, arguments: dict) -> dict:
        item_id = _require_str(arguments, "item_id")
        profile_id = _require_str(arguments, "profile_id")
        return _item_summary(self.service.set_category(item_id, profile_id))


def _require_str(arguments: dict, key: str) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"Tool argument {key!r} is required")
    return value


def _item_summary(item: ItemState) -> dict:
    return {
        "id": item.id,
        "name": item.name,
        "profile_id": item.profile_id,
        "opened": item.opened,
        "days_left": item.days_left,
        "freshness_fraction": item.freshness_fraction,
        "status": item.status,
        "confidence": item.confidence,
        "advice": item.advice,
    }

"""Structured food-label extraction through Ollama's multimodal chat API."""

from __future__ import annotations

import base64
from collections.abc import Sequence
from dataclasses import dataclass
import io
import json
import os
from typing import Any

import httpx
from PIL import Image

DEFAULT_BASE_URL = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen3.5:9b"
DEFAULT_TIMEOUT_SECONDS = 60.0
MAX_IMAGE_EDGE = 2048

_NULLABLE_STRING = {"anyOf": [{"type": "string"}, {"type": "null"}]}
LABEL_SCHEMA = {
    "type": "object",
    "properties": {
        "product_name": _NULLABLE_STRING,
        "brand": _NULLABLE_STRING,
        "printed_date": _NULLABLE_STRING,
        "package_size": _NULLABLE_STRING,
        "lot_code": _NULLABLE_STRING,
        "raw_text": {"type": "string"},
    },
    "required": [
        "product_name",
        "brand",
        "printed_date",
        "package_size",
        "lot_code",
        "raw_text",
    ],
    "additionalProperties": False,
}

_PROMPT = """Read these photos of the same food package and return only the requested JSON object.

Use every photo as another view of the same item. Transcribe all visible label text exactly into
raw_text, combining non-duplicate text across the photos and preserving line breaks where practical.
Extract product_name, brand, printed_date, package_size, and lot_code only when each value is
visibly printed in at least one photo. Do not infer, repair, autocomplete, or invent missing
text. Use null for every field that is absent, obscured, blurry, or uncertain. Keep date and
size text in the form printed on the package.
"""


class VisionOCRError(RuntimeError):
    """The model responded, but its structured label result was unusable."""


@dataclass(frozen=True)
class VisionLabel:
    product_name: str
    brand: str | None
    printed_date: str | None
    package_size: str | None
    lot_code: str | None
    raw_text: str
    confidence: float


def extract_label(images: Sequence[Image.Image]) -> VisionLabel:
    """Extract grounded label fields from several views with Qwen vision."""
    if not images:
        raise ValueError("At least one image is required")
    response = httpx.post(
        _chat_url(),
        timeout=_timeout_seconds(),
        json={
            "model": _setting("OCR_MODEL", "LLM_MODEL", "OMLX_MODEL", default=DEFAULT_MODEL),
            "stream": False,
            # Ollama enables reasoning by default for thinking-capable models such
            # as Qwen 3.5. OCR only needs the schema-bound final answer, and some
            # Ollama/Qwen combinations can exhaust the response in `thinking`
            # without producing `message.content`, which leaves no JSON to parse.
            "think": False,
            "format": LABEL_SCHEMA,
            "options": {"temperature": 0},
            "keep_alive": os.environ.get("OCR_KEEP_ALIVE", "10m"),
            "messages": [
                {
                    "role": "user",
                    "content": _PROMPT,
                    "images": [_encode_image(image) for image in images],
                }
            ],
        },
    )
    response.raise_for_status()

    try:
        content = response.json()["message"]["content"]
        if not isinstance(content, str):
            raise TypeError("message content must be text")
        payload = json.loads(_strip_code_fence(content))
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise VisionOCRError("Qwen returned an invalid structured OCR response") from exc

    return _validate_payload(payload)


def _chat_url() -> str:
    base_url = _setting(
        "OCR_BASE_URL",
        "LLM_BASE_URL",
        "OMLX_BASE_URL",
        default=DEFAULT_BASE_URL,
    ).rstrip("/")
    if base_url.endswith("/v1"):
        base_url = base_url[:-3]
    if base_url.endswith("/api"):
        return f"{base_url}/chat"
    return f"{base_url}/api/chat"


def _setting(name: str, *fallback_names: str, default: str) -> str:
    for candidate in (name, *fallback_names):
        value = os.environ.get(candidate)
        if value:
            return value
    return default


def _timeout_seconds() -> float:
    raw = os.environ.get("OCR_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        timeout = float(raw)
    except ValueError as exc:
        raise VisionOCRError("OCR_TIMEOUT_SECONDS must be numeric") from exc
    if timeout <= 0:
        raise VisionOCRError("OCR_TIMEOUT_SECONDS must be positive")
    return min(timeout, DEFAULT_TIMEOUT_SECONDS)


def _encode_image(image: Image.Image) -> str:
    prepared = image.copy()
    prepared.thumbnail((MAX_IMAGE_EDGE, MAX_IMAGE_EDGE), Image.Resampling.LANCZOS)
    if prepared.mode != "RGB":
        prepared = prepared.convert("RGB")
    buffer = io.BytesIO()
    prepared.save(buffer, format="JPEG", quality=92, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _strip_code_fence(content: str) -> str:
    stripped = content.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()
    if lines:
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def _validate_payload(payload: Any) -> VisionLabel:
    if not isinstance(payload, dict):
        raise VisionOCRError("Qwen OCR response must be a JSON object")

    raw_text = _optional_text(payload.get("raw_text")) or ""
    candidates = {
        "product_name": _optional_text(payload.get("product_name")),
        "brand": _optional_text(payload.get("brand")),
        "printed_date": _optional_text(payload.get("printed_date")),
        "package_size": _optional_text(payload.get("package_size")),
        "lot_code": _optional_text(payload.get("lot_code")),
    }

    extracted = [value for value in candidates.values() if value is not None]
    grounded = {
        name: value if value is not None and _is_grounded(value, raw_text) else None
        for name, value in candidates.items()
    }
    grounded_count = sum(value is not None for value in grounded.values())
    confidence = round(grounded_count / len(extracted), 2) if extracted else 0.0

    return VisionLabel(
        product_name=grounded["product_name"] or "Unknown item",
        brand=grounded["brand"],
        printed_date=grounded["printed_date"],
        package_size=grounded["package_size"],
        lot_code=grounded["lot_code"],
        raw_text=raw_text,
        confidence=confidence,
    )


def _optional_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise VisionOCRError("Qwen OCR fields must be strings or null")
    stripped = value.strip()
    return stripped or None


def _is_grounded(value: str, raw_text: str) -> bool:
    normalized_value = "".join(
        character for character in value.casefold() if character.isalnum()
    )
    normalized_raw = "".join(
        character for character in raw_text.casefold() if character.isalnum()
    )
    return bool(normalized_value) and normalized_value in normalized_raw

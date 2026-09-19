"""Environment configuration for the API.

Loads the repo-root `.env` once at import time. `main.py` builds its
`FreshnessService`/`LLMGateway` singletons at module scope -- before any request
and before uvicorn's own startup hooks -- so the load has to happen on import of
this module, which `llm/gateway.py` pulls in first.

A value already present in the real environment always wins over `.env`, so a
shell environment variable still overrides the file.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(REPO_ROOT / ".env")


def env_with_fallback(name: str, legacy_name: str, default: str) -> str:
    """Read the preferred variable, then its legacy alias, then the default."""
    value = os.environ.get(name)
    if value is None:
        value = os.environ.get(legacy_name)
    return default if value is None else value

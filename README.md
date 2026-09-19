# Freshness Tracker

A food freshness tracker with a Python engine, FastAPI backend, telemetry
simulator, and Expo mobile app.

The freshness engine, telemetry simulator, inventory service, local-model assistant,
and API with label scanning are implemented. The mobile app is still a scaffold.

## Repository layout

```text
apps/
  api/          FastAPI backend package
  mobile/       Expo mobile dependencies and TypeScript configuration
engine/         Freshness calculation package
simulator/      Telemetry simulation package
tests/
  api/          Backend tests
  engine/       Freshness engine tests
  simulator/    Telemetry simulation tests
docs/           Project documentation
```

## Dependency setup

Python 3.12 or newer is required. Create a virtual environment from the
repository root and install the Python dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
```

With Node.js and npm installed, install the mobile dependencies using the
committed lockfile:

```sh
cd apps/mobile
npm ci
```

## Run the API

From the repository root, with the Python environment activated:

```sh
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8010
python -m pytest -q
```

On Windows, create the environment with `py -3.14 -m venv .venv` (or another
installed Python 3.12+), then activate it with `.\.venv\Scripts\Activate.ps1`.

Interactive API documentation is available at `http://localhost:8010/docs`.
The API supports inventory actions, telemetry ingestion, freshness state,
demo scenarios, CSV replay, OCR scan/confirm, and assistant messages.
Inventory and telemetry are held in memory and reset when the server restarts.

Label scanning and the OCR integration tests require the Tesseract executable on
PATH. PNG/JPEG and HEIC photos are supported, including orientation correction.

The assistant requires a separately running model server supporting tool calls.
Copy `.env.example` to `.env`, set `OMLX_BASE_URL`, `OMLX_MODEL`, and optionally
`OMLX_API_KEY`, then add `--env-file .env` to the uvicorn command. These settings
also work with compatible servers other than oMLX. Other API features work
without a model server.

CSV replay paths are confined to `FRESHNESS_DATA_DIR` (default `./data`). Use
`POST /api/demo/replay` with a JSON body such as
`{"path": "beef.csv", "sensor_column": "MQ135"}`.

This is a waste-reduction prototype, not a food-safety device. Food-profile
coefficients are placeholders. Only the temperature track originates remaining
freshness; gas and label signals can only shorten it.

# Freshness Tracker

A food-freshness prototype: a Python freshness engine, a FastAPI backend, a
telemetry simulator, an Expo mobile app, and a BME688 sensor sketch that uploads to
ThingSpeak.

This is an experimental waste-reduction prototype. Five profiles use USDA FSIS
storage guidance; four remain placeholders. Days left use recorded temperature exposure and
project future storage at 4C. Display rounds down to whole days or less than one
day. A warm fridge also gets a current-conditions correction and an aging-rate
readout, both prospective what-ifs that never undo accrued exposure. Gas is an
experimental fridge-level signal with no influence on estimates.

Run only one API worker for one household. There is no account isolation or
authentication. Do not deploy multiple processes against the same SQLite file:
each process owns an in-memory snapshot that can overwrite another process.
Keep the demo on a trusted local network. This limit is documented, not fixed.

## Current state

| Area | Status |
| --- | --- |
| Freshness engine | Working. Temperature (Q10 budget), gas anomaly and color-label tracks, fused. Only the temperature track sets remaining freshness; gas and color can only **shorten** it or veto to 0. |
| Backend API | Working. Items, telemetry, alerts, OCR, assistant, demo control. **All state is in memory** unless `FRESHNESS_DB_PATH` is set. Nothing is seeded: live and demo inventories both start empty. |
| Live telemetry | Optional. The API polls a ThingSpeak channel when `THINGSPEAK_CHANNEL_ID` is set. The sensor has no door switch, so every live sample counts as door-closed. Gas needs a raw-ohms field (`THINGSPEAK_GAS_FIELD`); without it only the temperature track runs. |
| Simulator | Working. Synthetic scenarios and Mendeley-style CSV replay, both feeding `service.ingest` directly. |
| Mobile app | Working on iOS/Android. Fridge dashboard (grid/list), notifications screen, item details (rename, category, mark opened, label score, delete, aging rate, current-conditions correction, storage-temperature suggestion), manual add, multi-photo label scan, voice-capable assistant, persistent Celsius/Fahrenheit and theme settings, in-app user manual, splash overlay. No auth or durable inventory; the API owns inventory state. |
| Label scan (OCR) | Qwen vision model via Ollama by default (up to 5 photos, all fields editable before confirm). Tesseract is an explicit legacy single-photo mode. |
| Assistant | Local OpenAI-compatible tool-calling model (default Ollama `qwen3.5:9b`). It can only act through validated tools and never produces freshness numbers itself. |
| Hardware | `hardware/sketch.cpp` (Arduino/BSEC2, WiFi) uploads readings to ThingSpeak every 20 s. CAD in `hardware/STL_files/`. The API reads that channel; the board never talks to the API directly. |
| Not built | Persistence, authentication, shared-fridge gas semantics, model calibration/validation, automated mobile UI tests. |

## Profile provenance

`engine/foods.json` carries a `source` per category. Five categories use
published guidance; four remain `placeholder` demo coefficients.

**D0 (unopened shelf life at 4C) — USDA FSIS cold storage guidance:**

| Category | FSIS guidance | `d0_days` |
| --- | --- | --- |
| Red meat (beef/pork/lamb) | 3-5 days | 4.0 |
| Poultry | 2 days | 2.0 |
| Seafood / fish | 2 days | 2.0 |
| Eggs (in shell) | 3-5 weeks | 28.0 |
| Dairy (milk) | 5-7 days | 6.0 |

Ground meat also falls under the FSIS 2-day guidance; it is currently folded
into `red_meat` (4.0 days) rather than split out, so ground cuts are the
optimistic end of that profile.

**Q10 = 2.7 (`q10_source: fitted-published-multitemp`):** fitted by log-linear
regression of published chicken sensory shelf-life against storage temperature:

| Temperature | Shelf life (days) |
| --- | --- |
| 0 C | 13.33 |
| 4 C | 9.17 |
| 10 C | 5.00 |
| 15 C | 3.00 |

R^2 = 0.9997. The fit is on poultry data and is reused for red meat, seafood
and dairy as the best available multi-temperature estimate; it is not
independently validated for those categories. Eggs keep q10 2.0 and the four
placeholder categories keep their demo values, none of which are fitted.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `engine/` | Pure freshness functions (`burn.py`, `gas.py`, `conditioning.py`, `fusion.py`) and `foods.json` profiles |
| `apps/api/` | FastAPI app: `main.py` routes, `service.py` logic, `store.py` state, `schemas.py`, `ocr.py` / `vision_ocr.py`, `thingspeak.py`, `llm/` (gateway + tools) |
| `simulator/` | `scenarios.json`, scenario generator, CSV replay |
| `apps/mobile/` | Expo SDK 57 app (`src/app` routes, `src/components`, `src/lib`) |
| `hardware/` | ESP32 sketch, vendored libraries, 3D-print enclosure files |
| `tests/` | `engine/`, `simulator/`, `api/` pytest suites |

```mermaid
flowchart LR
    BOARD[BME688 board] --> TS[ThingSpeak]
    TS --> POLL[ThingSpeak poller]
    POLL --> SERVICE
    SIM[Simulator / CSV replay] --> SERVICE[Freshness service]
    HTTP[POST /api/telemetry] --> SERVICE
    SERVICE <--> ENGINE[Temperature / gas / label fusion]
    SERVICE <--> STORE[In-memory store]
    APP[Expo app] --> API[FastAPI]
    API --> SERVICE
    API --> OCR[Qwen vision OCR<br/>Tesseract legacy]
    API --> LLM[Model gateway and validated tools]
    LLM --> SERVICE
```

## Setup

### Backend

Python 3.12+, from the repo root:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
cp .env.example .env
python -m uvicorn apps.api.main:app --host 0.0.0.0 --port 8010 --env-file .env
```

API docs: <http://localhost:8010/docs>. On Windows, activate with
`.\.venv\Scripts\Activate.ps1` and use `Copy-Item` instead of `cp`.

The API documentation is at <http://localhost:8010/docs>. Set
`FRESHNESS_DB_PATH=./data/freshness.sqlite3` in the root `.env` to persist live
inventory and telemetry. Without this setting, storage is in memory.
Demo routes use a separate service and `${FRESHNESS_DB_PATH}.demo` database
(or a separate in-memory store when persistence is not configured).
The mobile dashboard reads live state; demo state is at `/api/demo/state`.

Keep `ENABLE_EXPERIMENTAL_FUSION=false` for the demo. The legacy gas/label
weighting and veto code remains behind that opt-in flag. Sigma values and the
calibration JSON loader are unused when the flag is off; the API reports this.
`engine/gas_calibrate.py` is NOT FOR REPORTING: its model selection and accuracy
metrics need correction. Generated artifacts carry `reportable: false` and are
rejected as sources of fusion uncertainty.

The telemetry buffer retains 10,000 raw readings (about 55 hours at 20 seconds).
Every accepted reading updates temperature exposure; readings are not downsampled
for integration. Data older than three minutes is displayed as disconnected.
Exposure outside -1C through 25C stops integration for that interval and leaves a
persisted warning. The UI withholds the estimate because that exposure is unknown.
Category changes replay retained temperatures using the new Q10. If accrued
exposure predates retained history, the API refuses the category change.

Key `.env` values (see `.env.example` for all):

| Variable | Purpose |
| --- | --- |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Assistant model server (legacy `OMLX_*` names still work as fallbacks) |
| `OCR_ENGINE`, `OCR_BASE_URL`, `OCR_MODEL`, `OCR_TIMEOUT_SECONDS`, `OCR_KEEP_ALIVE` | Label scanning (`qwen` or `tesseract`) |
| `THINGSPEAK_CHANNEL_ID`, `THINGSPEAK_READ_API_KEY`, `THINGSPEAK_POLL_SECONDS`, `THINGSPEAK_GAS_FIELD` | Optional live telemetry; leave the channel blank to disable |
| `FRESHNESS_DATA_DIR` | Where CSV replay files live (default `./data`) |

`apps/api/config.py` loads the root `.env` on import; real environment variables win.
Qwen requests have a 15-second deadline; failures open manual entry in the app.
After OCR the user must explicitly tap a category before confirming the item.
`OCR_ENGINE=tesseract` remains an explicit legacy single-photo mode for development
and deterministic OCR tests; it requires the **Tesseract executable** on PATH.

### Model server (assistant and scanning)

Both use [Ollama](https://ollama.com) by default:

```sh
ollama pull qwen3.5:9b
ollama show qwen3.5:9b     # must list "tools" under capabilities
```

Start Ollama before using the assistant or Scan tab. Everything else works without it.
Qwen failures are returned to the app; they do not silently fall back to Tesseract.
`OCR_ENGINE=tesseract` needs the `tesseract` binary (`brew install tesseract`).

### Mobile

Node 22.13+:

```sh
cd apps/mobile
npm ci
cp .env.example .env
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL=http://<laptop LAN IP>:8010/api` in `apps/mobile/.env`
(`ipconfig getifaddr en0` on macOS). `localhost` on a phone is the phone. Restart
Expo after changing it.

Voice input uses a native speech module, so it needs a development or release
build, not Expo Go.

### Standalone iOS build on a physical iPhone

Needs full Xcode, an Apple ID under Xcode Settings → Accounts, and Developer Mode on
the phone.

```sh
cd apps/mobile
npm run ios                        # Release build + install (scripts/ios-device.sh)
IOS_DEVICE=<udid> npm run ios      # another phone: xcrun devicectl list devices
npx expo prebuild --platform ios   # only after app.json or native-dependency changes
(cd ios && pod install)
```

- Do **not** use `npx expo run:ios`: it forces parallel codesigning, which fails here
  with `errSecInternalComponent` and yields an app that builds but won't install.
  `scripts/ios-device.sh` signs serially and verifies every framework.
- `ios/` is generated and gitignored. Edit `app.json`, never the Xcode project.
  Signing lives in `ios.appleTeamId`; `plugins/with-script-sandbox-disabled.js`
  reapplies the setting the Metro bundling phase needs on each prebuild.
- Release embeds the JS bundle, so no Metro is needed, but the backend must be
  reachable at `EXPO_PUBLIC_API_BASE_URL`. Free Apple ID signing expires after 7 days.
- If `app.json` icons/logo change, rerun `python scripts/build-icons.py`.

## Demo and replay

The demo service is isolated from live state and also starts empty — add items
through the API or the app before starting a scenario. Demo control is API-only:

```sh
curl -X POST http://127.0.0.1:8010/api/demo/scenarios/hot_car/start
curl http://127.0.0.1:8010/api/demo/state
```

```sh
curl -X POST http://127.0.0.1:8010/api/demo/stop
curl -X POST http://127.0.0.1:8010/api/demo/reset
```

Scenarios: `normal`, `hot_car`, `door_open`, `spoilage`, `contradiction`,
`past_budget_quiet`. Reset clears telemetry, alerts and the gas baseline and
restores every existing item's freshness budget; it does not add or remove items.

CSV replay (file under `FRESHNESS_DATA_DIR`, columns `Minute`, `Temperature`,
`Humidity` and an `MQ*` column):

```sh
curl -X POST http://127.0.0.1:8010/api/demo/replay \
  -H 'Content-Type: application/json' \
  -d '{"path":"beef.csv","sensor_column":"MQ135"}'
```

Datasets are not distributed. Replay exercises the pipeline; it does not validate
BME680/688 performance. Check units before interpreting replayed gas values.

## Development guide

### Verify

```sh
python -m pytest -q                                   # backend, from repo root
python -m pytest tests/engine/test_fusion.py -q       # one file
cd apps/mobile && npx tsc --noEmit                    # types
cd apps/mobile && npx expo export --platform all      # bundling check, not a device test
```

Tests run real Tesseract on rendered label images (needs the binary). LLM tests
monkeypatch `LLMGateway._chat`, so no model server is needed. Tests that need
isolated state monkeypatch `main.service` and `main.simulator` (see
`tests/api/test_replay_api.py`); otherwise they share the global singleton.

### Rules to keep

- **Engine invariant:** tracks B and C may only shorten Track A's days or veto to 0.
  `engine/` stays pure (no I/O beyond loading `foods.json`).
- **Aging rate and storage optimization** are Track A only: `current_aging_rate`
  (`engine/burn.py`) and `FreshnessService._storage_optimization` compare the
  current reading against the 4C reference. They are prospective what-ifs and
  never undo accrued exposure. Both yield `None` / `temperature_action:
  "unavailable"` when the reading is missing, stale or outside the modelled
  range — never a fabricated 1.0x.
- **Alerts** are recomputed from scratch by `_refresh_alerts()`. Any service
  mutation that affects freshness must call it.
- **All telemetry goes through `service.ingest`** (HTTP, simulator, replay,
  ThingSpeak poller).
- **Routes stay thin:** `KeyError` → 404, `ValueError` → 400; validation lives in
  `schemas.py`.
- **Assistant:** the model never produces freshness numbers. To add a tool, add an
  entry to `TOOL_SCHEMAS` and a matching `_tool_<name>` in `apps/api/llm/tools.py`.
- **OCR contract:** scan → user edits → `/api/ocr/confirm`. Parsing can change
  without changing that contract. Scan stores a 512 px thumbnail keyed by `scan_id`.
- **Mobile:** all backend calls go through `src/lib/api.ts` (12 s timeout; scans have
  their own longer deadline). `src/lib/types.ts` mirrors backend schemas by hand,
  so change both together. Food categories come from `GET /api/profiles`; never
  hardcode them. Styles use `useStyles(makeStyles)` from `src/lib/theme.tsx`;
  colors can't be read at module scope.
- Read the [Expo SDK 57 docs](https://docs.expo.dev/versions/v57.0.0/) before
  changing SDK integrations.

### Common tasks

- **Add a food profile:** edit `engine/foods.json`; the app picks it up via `/api/profiles`.
- **Change an API shape:** update `apps/api/schemas.py`, the route, `apps/mobile/src/lib/types.ts`
  and `api.ts`, and add a test under `tests/api/`.
- **Add a scenario:** add it to `simulator/scenarios.json` and `scenarios.py`, with a test in
  `tests/simulator/`.

### Hardware

`hardware/sketch.cpp` reads a BME688 through BSEC2 and posts to ThingSpeak every
20 s after a ~5 minute calibration. Set the WiFi SSID and write key in the sketch
constants for your own channel; keep real keys out of git. `hardware/lib/` holds
vendored libraries; don't edit them.

## Known limitations

No persistence or auth; placeholder coefficients; no shared-fridge gas semantics;
no automated mobile interaction tests; web preview lacks OCR upload and item
deletion.

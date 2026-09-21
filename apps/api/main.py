from contextlib import asynccontextmanager
import asyncio
from dataclasses import asdict
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from engine.models import TelemetrySample

from . import ocr as ocr_module
from .vision_ocr import _timeout_seconds as _ocr_timeout_seconds
from .llm.gateway import LLMGateway
from .llm.tools import ToolDispatcher
from .schemas import (
    AppStateOut,
    AssistantMessageIn,
    AssistantMessageOut,
    CategoryIn,
    ItemCreate,
    ItemOut,
    LabelScoreIn,
    OCRConfirmIn,
    OCRResultOut,
    ProfileOut,
    RenameIn,
    ReplayIn,
    TelemetryIn,
)
from .service import FreshnessService
from .thingspeak import ThingSpeakConfig, ThingSpeakPoller
from simulator.scenarios import available_scenarios
from simulator.mendeley_replay import load_mendeley_csv
from simulator.sensor_sim import SensorSimulator

service = FreshnessService(storage_path=os.environ.get("FRESHNESS_DB_PATH") or None)
demo_service = FreshnessService(storage_path=(service.store.storage_path + ".demo"
                                              if service.store.storage_path else None))
simulator = SensorSimulator(demo_service.ingest, demo_service.reset_demo_state, demo_service.store)
tool_dispatcher = ToolDispatcher(service)
llm_gateway = LLMGateway(tool_dispatcher)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Read at startup rather than import so tests can switch the live feed off.
    config = ThingSpeakConfig.from_env()
    poller = ThingSpeakPoller(config, service.ingest, service.store,
                            history_callback=service.restore_complete_history) if config else None
    if poller is not None:
        poller.start()
    yield
    if poller is not None:
        await poller.stop()
    await simulator.stop()


app = FastAPI(title="Freshness Tracker API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/state", response_model=AppStateOut)
def get_state():
    return service.snapshot()


@app.get("/api/diagnostics/gas")
async def gas_diagnostics():
    return service.gas_diagnostics()


@app.post("/api/telemetry", response_model=AppStateOut)
def post_telemetry(payload: TelemetryIn):
    return service.ingest(TelemetrySample(**payload.model_dump()))


@app.get("/api/profiles", response_model=list[ProfileOut])
def get_profiles():
    """Food categories from engine/foods.json, so clients never hardcode the list."""
    return [ProfileOut(**asdict(profile)) for profile in service.profiles.values()]


@app.get("/api/items", response_model=list[ItemOut])
def get_items():
    return service.snapshot().items


@app.post("/api/items", response_model=ItemOut, status_code=201)
def add_item(payload: ItemCreate):
    try:
        return service.add_item(payload.profile_id, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/items/{item_id}", response_model=ItemOut)
def get_item(item_id: str):
    try:
        return service.get_item(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: str):
    """Remove an item -- the recovery path for a bad scan."""
    try:
        service.remove_item(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/items/{item_id}/opened", response_model=ItemOut)
def mark_opened(item_id: str):
    try:
        return service.mark_opened(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/items/{item_id}/label-score", response_model=ItemOut)
def set_label_score(item_id: str, payload: LabelScoreIn):
    try:
        return service.set_label_score(item_id, payload.score)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/items/{item_id}/rename", response_model=ItemOut)
def rename_item(item_id: str, payload: RenameIn):
    try:
        return service.rename_item(item_id, payload.name)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/items/{item_id}/category", response_model=ItemOut)
def set_category(item_id: str, payload: CategoryIn):
    try:
        return service.set_category(item_id, payload.profile_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/items/{item_id}/photo")
def get_item_photo(item_id: str):
    """The scan thumbnail, or 404 for a manually-added item."""
    try:
        photo = service.get_item_photo(item_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    # Immutable once the item exists, and the URL is keyed by item id.
    return Response(content=photo, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@app.post("/api/ocr/scan", response_model=OCRResultOut)
async def ocr_scan(
    images: list[UploadFile] | None = File(default=None),
    image: UploadFile | None = File(default=None),
):
    # `image` keeps older app builds compatible; new clients repeat `images` for
    # each view. Limiting the set keeps request size and local vision inference bounded.
    uploads = images or ([image] if image is not None else [])
    if not uploads:
        raise HTTPException(status_code=400, detail="At least one image is required")
    if len(uploads) > 5:
        raise HTTPException(status_code=400, detail="A scan supports at most 5 images")
    contents = [await upload.read() for upload in uploads]
    try:
        # Vision inference can take tens of seconds during a cold model load. Keep
        # the event loop free so health, inventory, and telemetry requests continue.
        result = await asyncio.wait_for(run_in_threadpool(ocr_module.scan_images, contents), timeout=_ocr_timeout_seconds())
        # The first photo is the one the user framed at the product, so it is the
        # one worth keeping as the item's thumbnail.
        thumbnail = await run_in_threadpool(ocr_module.thumbnail, contents[0])
        return {**result, "scan_id": service.stash_scan_photo(thumbnail)}
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise HTTPException(status_code=503, detail="OCR timed out. Enter the item manually.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (httpx.HTTPError, ocr_module.VisionOCRError) as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.post("/api/ocr/confirm", response_model=ItemOut, status_code=201)
def ocr_confirm(payload: OCRConfirmIn):
    if not payload.category_confirmed:
        raise HTTPException(status_code=400, detail="Confirm the food category before adding the item")
    try:
        return service.add_item(
            payload.profile_id,
            payload.name,
            brand=payload.brand,
            printed_date=payload.printed_date,
            package_size=payload.package_size,
            lot_code=payload.lot_code,
            photo=service.take_scan_photo(payload.scan_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/assistant/message", response_model=AssistantMessageOut)
def assistant_message(payload: AssistantMessageIn):
    try:
        return llm_gateway.converse(payload.message)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Local LLM unavailable: {exc}") from exc


@app.post("/api/demo/scenarios/{name}/start")
async def start_scenario(name: str):
    if name not in available_scenarios():
        raise HTTPException(
            status_code=404,
            detail={"message": f"Unknown scenario: {name}", "available": available_scenarios()},
        )
    await simulator.start(name)
    return {"status": "started", "scenario": name}


@app.post("/api/demo/stop")
async def stop_demo():
    await simulator.stop()
    return {"status": "stopped"}


@app.post("/api/demo/reset", response_model=AppStateOut)
async def reset_demo():
    await simulator.reset()
    return demo_service.snapshot()


@app.get("/api/demo/state", response_model=AppStateOut)
def get_demo_state():
    return demo_service.snapshot()


@app.post("/api/demo/replay", response_model=AppStateOut)
async def replay_mendeley(payload: ReplayIn):
    data_dir = Path(os.environ.get("FRESHNESS_DATA_DIR", "./data")).resolve()
    requested = Path(payload.path)
    candidate = requested.resolve() if requested.is_absolute() else (data_dir / requested).resolve()
    if not candidate.is_relative_to(data_dir):
        raise HTTPException(status_code=400, detail="Replay path must stay inside FRESHNESS_DATA_DIR")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Replay file not found")
    try:
        rows = load_mendeley_csv(candidate, payload.sensor_column)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    await simulator.stop(mark_paused=False)
    demo_service.reset_demo_state()
    demo_service.store.active_scenario = "mendeley_replay"
    for sample in rows:
        demo_service.ingest(sample)
    demo_service.store.active_scenario = None
    demo_service.store.telemetry_paused = True
    return demo_service.snapshot()

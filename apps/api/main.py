from contextlib import asynccontextmanager
from dataclasses import asdict
import os
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from engine.models import TelemetrySample

from . import ocr as ocr_module
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
from simulator.scenarios import available_scenarios
from simulator.mendeley_replay import load_mendeley_csv
from simulator.sensor_sim import SensorSimulator

service = FreshnessService()
simulator = SensorSimulator(service.ingest, service.reset_demo_state, service.store)
tool_dispatcher = ToolDispatcher(service)
llm_gateway = LLMGateway(tool_dispatcher)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
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


@app.post("/api/ocr/scan", response_model=OCRResultOut)
async def ocr_scan(image: UploadFile = File(...)):
    content = await image.read()
    try:
        return ocr_module.scan_image(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/ocr/confirm", response_model=ItemOut, status_code=201)
def ocr_confirm(payload: OCRConfirmIn):
    try:
        return service.add_item(
            payload.profile_id,
            payload.name,
            brand=payload.brand,
            printed_date=payload.printed_date,
            package_size=payload.package_size,
            lot_code=payload.lot_code,
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
    return service.snapshot()


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
    service.reset_demo_state()
    service.store.active_scenario = "mendeley_replay"
    for sample in rows:
        service.ingest(sample)
    service.store.active_scenario = None
    service.store.telemetry_paused = True
    return service.snapshot()

from typing import Any

from pydantic import BaseModel, Field


class TelemetryIn(BaseModel):
    timestamp: float
    temperature: float
    humidity: float = Field(ge=0, le=100)
    gas_resistance: float = Field(gt=0)
    door_open: bool


class ItemCreate(BaseModel):
    profile_id: str
    name: str | None = None


class LabelScoreIn(BaseModel):
    score: float = Field(ge=0, le=1)


class RenameIn(BaseModel):
    name: str = Field(min_length=1)


class CategoryIn(BaseModel):
    profile_id: str


class ProfileOut(BaseModel):
    id: str
    name: str
    d0_days: float
    opened_d0_days: float
    q10: float
    placeholder: bool
    advice: str


class OCRResultOut(BaseModel):
    product_name: str
    brand: str | None
    printed_date: str | None
    package_size: str | None
    lot_code: str | None
    raw_text: str
    confidence: float
    suggested_profile_id: str | None


class OCRConfirmIn(BaseModel):
    profile_id: str
    name: str | None = None
    brand: str | None = None
    printed_date: str | None = None
    package_size: str | None = None
    lot_code: str | None = None


class AssistantMessageIn(BaseModel):
    message: str = Field(min_length=1)


class AssistantToolCallOut(BaseModel):
    name: str
    arguments: dict[str, Any]
    result: Any


class AssistantMessageOut(BaseModel):
    reply: str
    tool_calls: list[AssistantToolCallOut]


class AlertOut(BaseModel):
    code: str
    message: str
    severity: str


class TelemetryOut(BaseModel):
    timestamp: float | None
    temperature: float | None
    humidity: float | None
    gas_resistance: float | None
    gas_anomaly: float | None
    door_open: bool | None
    burn_multiplier: float | None


class ItemOut(BaseModel):
    id: str
    name: str
    profile_id: str
    created_at: float
    t_eff: float
    opened: bool
    freshness_fraction: float
    track_a_days_left: float
    days_left: float
    confidence: str
    status: str
    placeholder_profile: bool
    advice: str
    color_score: float | None
    gas_anomaly: float | None
    brand: str | None = None
    printed_date: str | None = None
    package_size: str | None = None
    lot_code: str | None = None


class AppStateOut(BaseModel):
    telemetry: TelemetryOut
    items: list[ItemOut]
    alerts: list[AlertOut]
    active_scenario: str | None
    telemetry_paused: bool


class ReplayIn(BaseModel):
    path: str
    sensor_column: str | None = None

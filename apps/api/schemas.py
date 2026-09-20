from typing import Any

from pydantic import BaseModel, Field


class TelemetryIn(BaseModel):
    timestamp: float
    temperature: float
    humidity: float = Field(ge=0, le=100)
    gas_resistance: float = Field(gt=0)
    # Optional: the live BME688 sensor has no door switch.
    door_open: bool = False
    iaq_accuracy: int | None = Field(default=None, ge=0, le=3)


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
    source: str
    q10_source: str | None = None
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
    # Claim ticket for the scan's stored thumbnail; pass it back on confirm.
    scan_id: str | None = None


class OCRConfirmIn(BaseModel):
    category_confirmed: bool = False
    profile_id: str
    scan_id: str | None = None
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
    iaq_accuracy: int | None
    baseline_residual_sigma: float | None
    reading_age_seconds: float | None
    connected: bool
    aging_rate: float | None = None
    aging_rate_reference_q10: float = 2.7


class FusionUncertaintyOut(BaseModel):
    used_for_estimate: bool
    sigma_a: float
    sigma_b: float
    sigma_a_source: str
    sigma_b_source: str
    sigma_b_reason: str


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
    has_photo: bool = False
    data_gap_hours: float = 0.0
    fusion_uncertainty: FusionUncertaintyOut
    t_eff_incomplete: bool
    history_message: str | None
    outside_model_range: bool
    model_message: str | None
    profile_name: str
    d0_source: str
    q10_source: str
    aging_rate: float | None = None
    projection_temperature_c: float
    estimate_message: str | None


class AppStateOut(BaseModel):
    telemetry: TelemetryOut
    items: list[ItemOut]
    alerts: list[AlertOut]
    active_scenario: str | None
    telemetry_paused: bool


class ReplayIn(BaseModel):
    path: str
    sensor_column: str | None = None

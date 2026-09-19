from dataclasses import dataclass


@dataclass(frozen=True)
class FoodProfile:
    id: str
    name: str
    d0_days: float
    opened_d0_days: float
    q10: float
    placeholder: bool
    advice: str
    # Label words (singular) that suggest this category during OCR.
    keywords: tuple[str, ...] = ()


@dataclass(frozen=True)
class TelemetrySample:
    timestamp: float
    temperature: float
    humidity: float
    # None when the sensor sent no usable gas reading. Temperature still burns
    # the budget; the gas track just has nothing to score for that sample.
    gas_resistance: float | None
    door_open: bool


@dataclass(frozen=True)
class GasBaseline:
    beta: tuple[float, float, float, float]
    residual_mean: float
    residual_std: float


@dataclass(frozen=True)
class FusionResult:
    days_left: float
    confidence: str
    status: str

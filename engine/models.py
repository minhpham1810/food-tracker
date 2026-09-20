from dataclasses import dataclass


@dataclass(frozen=True)
class FoodProfile:
    id: str
    name: str
    d0_days: float
    opened_d0_days: float
    q10: float
    placeholder: bool
    source: str
    advice: str
    q10_source: str | None = None
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
    # BSEC IAQ accuracy: 3 is calibrated; lower values are warm-up readings.
    iaq_accuracy: int | None = None


@dataclass(frozen=True)
class GasBaseline:
    # Three coefficients are the reduced [1, T, RH] model; four include T*RH.
    beta: tuple[float, ...]
    residual_mean: float
    baseline_residual_sigma: float
    r2: float = 0.0
    condition_number: float = 0.0
    interaction: bool = True


@dataclass(frozen=True)
class FusionResult:
    days_left: float
    confidence: str
    status: str

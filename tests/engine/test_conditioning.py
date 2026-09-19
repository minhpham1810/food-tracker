from engine.conditioning import condition_samples, gas_baseline_samples
from engine.models import TelemetrySample


def test_door_open_samples_are_excluded_only_from_gas_baseline():
    samples = [
        TelemetrySample(0, 4.0, 60.0, 200_000.0, False),
        TelemetrySample(60, 12.0, 55.0, 180_000.0, True),
    ]
    baseline = gas_baseline_samples(samples)
    assert len(samples) == 2
    assert baseline == [samples[0]]


def test_conditioning_returns_uniform_grid_and_keeps_previous_door_state():
    samples = [
        TelemetrySample(0, 4.0, 60.0, 200_000.0, False),
        TelemetrySample(120, 6.0, 62.0, 198_000.0, True),
    ]
    conditioned = condition_samples(samples)
    assert [x.timestamp for x in conditioned] == [0.0, 60.0, 120.0]
    assert [x.door_open for x in conditioned] == [False, False, True]

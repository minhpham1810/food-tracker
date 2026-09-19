from engine.fusion import fuse


def test_secondary_tracks_never_extend_track_a():
    base = 6.0
    for gas in (0.0, 0.3, 0.8, 1.0):
        for color in (1.0, 0.7, 0.2, 0.0):
            assert fuse(base, 0.6, gas, color).days_left <= base


def test_hard_vetoes_zero_days():
    assert fuse(6.0, 0.6, 0.81, 1.0).days_left == 0.0
    assert fuse(6.0, 0.6, 0.0, 0.19).days_left == 0.0


def test_disagreement_is_surfaced():
    assert fuse(6.0, 0.6, 0.9, 1.0).status == "check_early"
    assert fuse(0.0, 0.0, 0.0, 1.0).status == "past_budget_quiet"


def test_unavailable_secondary_tracks_are_neutral():
    result = fuse(6.0, 0.6, None, None)
    assert result.days_left == 6.0
    assert result.confidence == "high"


def test_confidence_bins_follow_spread_thresholds():
    assert fuse(6.0, 0.6, 0.4, None).confidence == "high"
    assert fuse(6.0, 0.6, 0.2, None).confidence == "med"
    assert fuse(6.0, 0.6, 0.0, None).confidence == "low"


def test_expired_with_secondary_alarm_is_quality_discard_signal():
    assert fuse(0.0, 0.0, 0.9, None).status == "discard_quality_signal"

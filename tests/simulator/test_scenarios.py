from simulator.scenarios import available_scenarios, generate_scenario


def test_hot_car_gets_hotter_than_normal():
    normal = generate_scenario("normal", 0)
    hot = generate_scenario("hot_car", 0)
    assert max(x.temperature for x in hot) > max(x.temperature for x in normal)
    assert max(x.temperature for x in hot) >= 21.0


def test_spoilage_resistance_trends_down():
    samples = generate_scenario("spoilage", 0)
    assert samples[-1].gas_resistance < samples[0].gas_resistance


def test_door_scenario_marks_door_open():
    samples = generate_scenario("door_open", 0)
    assert any(x.door_open for x in samples)


def test_all_generated_payloads_are_valid_and_bounded():
    for name in available_scenarios():
        samples = generate_scenario(name, 0)
        assert 1 <= len(samples) <= 180
        for sample in samples:
            assert 0 <= sample.humidity <= 100
            assert sample.gas_resistance > 0


def test_gas_scenarios_have_clean_baseline_prefix():
    for name in ("spoilage", "contradiction"):
        samples = generate_scenario(name, 0)
        first = samples[:20]
        assert all(not x.door_open for x in first)
        assert max(x.gas_resistance for x in first) - min(x.gas_resistance for x in first) < 15_000


def test_past_budget_scenario_uses_accelerated_timestamps():
    samples = generate_scenario("past_budget_quiet", 0)
    assert samples[1].timestamp - samples[0].timestamp >= 6 * 3600

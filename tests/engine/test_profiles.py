from engine.profiles import load_profiles


def test_demo_profiles_are_present_and_marked_placeholder():
    profiles = load_profiles()
    assert set(profiles) == {"milk", "chicken", "spinach"}
    assert all(profile.placeholder for profile in profiles.values())
    assert all(profile.d0_days > 0 and profile.opened_d0_days > 0 for profile in profiles.values())
    assert all(profile.q10 > 1 for profile in profiles.values())

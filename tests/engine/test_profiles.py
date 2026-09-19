from engine.profiles import load_profiles


def test_generic_categories_are_present_and_marked_placeholder():
    profiles = load_profiles()
    assert {"red_meat", "poultry", "seafood", "dairy", "eggs", "vegetables"} <= set(profiles)
    assert all(profile.placeholder for profile in profiles.values())
    assert all(profile.d0_days > 0 and profile.opened_d0_days > 0 for profile in profiles.values())
    assert all(profile.q10 > 1 for profile in profiles.values())

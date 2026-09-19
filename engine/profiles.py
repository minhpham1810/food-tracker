import json
from pathlib import Path

from .models import FoodProfile

_REQUIRED_FIELDS = {
    "name",
    "d0_days",
    "opened_d0_days",
    "q10",
    "placeholder",
    "advice",
}


def load_profiles() -> dict[str, FoodProfile]:
    path = Path(__file__).with_name("foods.json")
    raw = json.loads(path.read_text(encoding="utf-8"))
    profiles: dict[str, FoodProfile] = {}
    for profile_id, values in raw.items():
        missing = _REQUIRED_FIELDS - values.keys()
        if missing:
            raise ValueError(f"Profile {profile_id!r} missing fields: {sorted(missing)}")
        keywords = tuple(word.lower() for word in values.pop("keywords", ()))
        profile = FoodProfile(id=profile_id, keywords=keywords, **values)
        if profile.d0_days <= 0 or profile.opened_d0_days <= 0 or profile.q10 <= 0:
            raise ValueError(f"Profile {profile_id!r} has invalid numeric values")
        profiles[profile_id] = profile
    return profiles

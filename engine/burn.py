def rate_multiplier(T: float, Q10: float, T_ref: float = 4.0) -> float:
    if Q10 <= 0:
        raise ValueError("Q10 must be positive")
    return Q10 ** ((T - T_ref) / 10.0)


def update_budget(t_eff: float, T: float, dt_hours: float, Q10: float) -> float:
    if t_eff < 0 or dt_hours < 0:
        raise ValueError("t_eff and dt_hours must be non-negative")
    return t_eff + (dt_hours / 24.0) * rate_multiplier(T, Q10)


def days_left(t_eff: float, D0: float, T_now: float, Q10: float) -> float:
    if D0 <= 0:
        raise ValueError("D0 must be positive")
    return max(0.0, (D0 - t_eff) / rate_multiplier(T_now, Q10))


def freshness_fraction(t_eff: float, D0: float) -> float:
    if D0 <= 0:
        raise ValueError("D0 must be positive")
    return max(0.0, min(1.0, 1.0 - (t_eff / D0)))

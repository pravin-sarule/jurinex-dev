from time import monotonic


def elapsed(started_at: float) -> float:
    return round(monotonic() - started_at, 4)

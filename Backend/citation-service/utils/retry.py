from typing import Callable, TypeVar

T = TypeVar("T")


def retry_once(fn: Callable[[], T]) -> T:
    try:
        return fn()
    except Exception:
        return fn()

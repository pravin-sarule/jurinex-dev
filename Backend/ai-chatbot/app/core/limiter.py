from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

# Single limiter instance imported by main.py (to attach to app.state)
# and by route modules (to apply @limiter.limit decorators).
limiter = Limiter(key_func=get_remote_address)

import hashlib


def stable_id(value: str, prefix: str = "") -> str:
    return f"{prefix}{hashlib.sha256((value or '').encode('utf-8')).hexdigest()[:12]}"

"""
Standalone Indian Kanoon API diagnostic.

Calls the IK /search/ endpoint DIRECTLY (raw urllib, NOT through the V2 pipeline)
to determine whether zero-candidate runs are caused by:
  - a bad / missing auth token,
  - an invalid `doctypes` value (the pipeline sends doctypes="judgments"),
  - over-restrictive query syntax (phrase quoting, ANDD operator).

Run:  ./venv/bin/python debug_ik_test.py
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    print("[warn] python-dotenv not installed; relying on ambient env vars")

_IK_BASE = "https://api.indiankanoon.org"


def _get_token() -> str | None:
    return (
        os.environ.get("INDIAN_KANOON_TOKEN")
        or os.environ.get("INDIAN_KANOON_API_TOKEN")
        or os.environ.get("IK_API_TOKEN")
    )


def raw_search(query: str, doctypes: str | None = None, pagenum: int = 0) -> None:
    """Mirror services.indian_kanoon._ik_request exactly, but print everything."""
    token = _get_token()
    label = f'formInput={query!r} doctypes={doctypes!r} pagenum={pagenum}'
    print("\n" + "=" * 80)
    print(f"REQUEST: {label}")
    print(f"  token present: {bool(token)}  (len={len(token) if token else 0})")

    if not token:
        print("  ABORT: no token in env (INDIAN_KANOON_TOKEN / INDIAN_KANOON_API_TOKEN / IK_API_TOKEN)")
        return

    params: dict[str, object] = {"formInput": query, "pagenum": pagenum}
    if doctypes:
        params["doctypes"] = doctypes
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{_IK_BASE}/search/?{qs}"
    print(f"  URL: {url}")

    req = urllib.request.Request(url, method="POST")
    req.add_header("Authorization", f"Token {token}")
    req.add_header("Accept", "application/json")
    req.add_header("User-Agent", "Mozilla/5.0 (compatible; JurinexCitation/1.0)")

    status: int | str
    body: str
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = getattr(e, "code", "?")
        try:
            body = e.read().decode("utf-8", errors="replace")
        except Exception:
            body = "<unreadable error body>"
    except Exception as exc:
        print(f"  TRANSPORT ERROR: {type(exc).__name__}: {exc}")
        return

    print(f"  HTTP status: {status}")
    print(f"  raw body (first 500 chars):\n    {body[:500]!r}")

    try:
        data = json.loads(body)
    except Exception as exc:
        print(f"  JSON parse FAILED: {exc}")
        return

    if isinstance(data, dict):
        print(f"  top-level keys: {sorted(data.keys())}")
        print(f"  reported 'found': {data.get('found')!r}  errmsg: {data.get('errmsg')!r}")
        docs = data.get("docs") or data.get("results") or data.get("judgments") or []
        print(f"  docs count (docs/results/judgments): {len(docs)}")
        if docs:
            first = docs[0]
            print(f"  first doc keys: {sorted(first.keys())}")
            print(f"  first doc tid/title: {first.get('tid')!r} | {str(first.get('title'))[:120]!r}")
    else:
        print(f"  response is not a dict: type={type(data).__name__}")


def main() -> None:
    print("Indian Kanoon API diagnostic")
    print(f"base: {_IK_BASE}")

    # Scenario 1: simplest possible query, NO doctypes filter.
    raw_search("natural justice")

    # Scenario 2: exactly what the V2 pipeline sends today (doctypes='judgments').
    raw_search("natural justice", doctypes="judgments")

    # Scenario 3: phrase-quoted (how query_service wraps multi-word terms).
    raw_search('"natural justice"')

    # Scenario 4: ANDD operator (V2 strict query syntax).
    raw_search('"natural justice" ANDD "audi alteram partem"')

    # Scenario 5: ANDD + doctypes='judgments' (full V2 strict-query reproduction).
    raw_search('"natural justice" ANDD "audi alteram partem"', doctypes="judgments")

    print("\n" + "=" * 80)
    print("DONE. Compare doc counts across scenarios to isolate the cause.")


if __name__ == "__main__":
    main()

from typing import Any


def get_cached_document(doc_id: str) -> dict | None:
    from db.client import ik_asset_get
    return ik_asset_get(doc_id, increment_hit=True)

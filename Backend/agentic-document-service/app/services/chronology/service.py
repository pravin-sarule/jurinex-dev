"""Public chronology helpers used by FolderWorkflowService."""
from __future__ import annotations

from typing import Any

from app.schemas.chronology import ChronologyTree

from .extract import extract_grounded_events
from .merge import empty_tree, merge_events
from . import persist


def events_from_extraction(
    entities: dict[str, Any] | None,
    *,
    source_text: str,
    document_name: str,
) -> list:
    return extract_grounded_events(
        entities or {},
        source_text=source_text,
        document_name=document_name,
    )


def merge_into_tree(existing: ChronologyTree | None, events: list) -> ChronologyTree:
    if not events and existing is not None:
        return existing
    if not events:
        return empty_tree()
    return merge_events(existing, events)


def load_or_empty(case_key: str, folder_name: str | None = None) -> ChronologyTree:
    return persist.load(case_key, folder_name) or empty_tree()


def save_tree(case_key: str, tree: ChronologyTree, folder_name: str | None = None) -> None:
    persist.save(case_key, tree, folder_name=folder_name)


def rebind_tree(old_key: str, new_key: str, folder_name: str | None = None) -> None:
    persist.rebind(old_key, new_key, folder_name=folder_name)


def delete_tree(case_key: str, folder_name: str | None = None) -> None:
    persist.delete(case_key, folder_name=folder_name)

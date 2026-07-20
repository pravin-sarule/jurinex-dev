from __future__ import annotations

import logging
import uuid
from typing import Any

from core.feature_flags import use_v2_pipeline

logger = logging.getLogger(__name__)


def run_pipeline(
    query: str,
    user_id: str,
    ingest_external: bool = True,
    case_file_context: list[dict[str, Any]] | None = None,
    case_id: str | None = None,
    retrieval_method: str = "indiankanoon",
    custom_keywords: list[str] | None = None,
    selected_keywords: list[str] | None = None,
    selected_case_names: list[str] | None = None,
    perspective: str | None = None,
    run_id: str | None = None,
) -> dict[str, Any]:
    effective_run_id = run_id or str(uuid.uuid4())
    if use_v2_pipeline():
        from pipeline.orchestrator import run_v2_pipeline
        return run_v2_pipeline(
            query=query, user_id=user_id, case_file_context=case_file_context, case_id=case_id,
            perspective=perspective, custom_keywords=custom_keywords, selected_keywords=selected_keywords,
            selected_case_names=selected_case_names, run_id=effective_run_id,
        )
    from legacy_pipeline import run_pipeline as run_legacy
    logger.warning("CITATION_PIPELINE_VERSION is legacy; cost and relevance protections are reduced")
    return run_legacy(
        query=query, user_id=user_id, ingest_external=ingest_external, case_file_context=case_file_context,
        case_id=case_id, retrieval_method=retrieval_method, custom_keywords=custom_keywords,
        selected_keywords=selected_keywords, selected_case_names=selected_case_names,
        perspective=perspective, run_id=effective_run_id,
    )

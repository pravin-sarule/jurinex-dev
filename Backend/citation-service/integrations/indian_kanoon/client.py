from __future__ import annotations

import logging
from typing import Any

from core.budgets import BudgetTracker
from models.citation_models import Candidate
from services.cost_service import record_ik_call
from utils.text import strip_html

logger = logging.getLogger(__name__)


class IndianKanoonClient:
    def __init__(self, run_id: str, user_id: str, budget: BudgetTracker):
        self.run_id = run_id
        self.user_id = user_id
        self.budget = budget

    def search(self, query: str, doctypes: str, issue_id: str) -> list[Candidate]:
        from services.indian_kanoon import ik_search
        self.budget.consume("ik_search")
        result = ik_search(query=query, pagenum=0, maxpages=1, doctypes=doctypes) or {}
        record_ik_call(self.run_id, self.user_id, "search", endpoint="/search/", issue_id=issue_id, success=bool(result))
        logger.debug("IK search response", extra={"details": {"run_id": self.run_id, "issue_id": issue_id, "query": query, "found": result.get("found"), "raw_response": result}})
        candidates = []
        for row in (result.get("docs") or [])[:20]:
            doc_id = str(row.get("tid") or row.get("id") or "").strip()
            if not doc_id:
                continue
            candidates.append(Candidate(
                doc_id=doc_id,
                title=strip_html(str(row.get("title") or "")),
                headline=strip_html(str(row.get("headline") or "")),
                docsource=str(row.get("docsource") or ""),
                matched_issue_id=issue_id,
                matched_query=query,
                metadata=dict(row),
            ))
        return candidates

    def fetch_fragment(self, candidate: Candidate) -> Candidate:
        from services.indian_kanoon import ik_fetch_docfragment
        self.budget.consume("ik_fragment")
        result = ik_fetch_docfragment(candidate.doc_id, candidate.matched_query) or {}
        record_ik_call(self.run_id, self.user_id, "fragment", endpoint=f"/docfragment/{candidate.doc_id}/", candidate_doc_id=candidate.doc_id, issue_id=candidate.matched_issue_id, success=bool(result))
        logger.debug("IK fragment response", extra={"details": {"run_id": self.run_id, "doc_id": candidate.doc_id, "raw_response": result}})
        candidate.fragment = strip_html(str(result.get("headline") or ""))
        candidate.metadata["fragment_data"] = result
        return candidate

    def fetch_meta(self, candidate: Candidate) -> Candidate:
        from services.indian_kanoon import ik_fetch_docmeta
        self.budget.consume("ik_meta")
        result = ik_fetch_docmeta(candidate.doc_id) or {}
        record_ik_call(self.run_id, self.user_id, "meta", endpoint=f"/docmeta/{candidate.doc_id}/", candidate_doc_id=candidate.doc_id, issue_id=candidate.matched_issue_id, success=bool(result))
        logger.debug("IK metadata response", extra={"details": {"run_id": self.run_id, "doc_id": candidate.doc_id, "raw_response": result}})
        candidate.metadata["meta_data"] = result
        candidate.title = strip_html(str(result.get("title") or candidate.title))
        candidate.docsource = str(result.get("docsource") or candidate.docsource)
        candidate.publishdate = str(result.get("publishdate") or result.get("date") or "")
        return candidate

    def fetch_full_document(self, candidate: Candidate) -> Candidate:
        from db.client import ik_asset_get, ik_asset_upsert
        from services.indian_kanoon import ik_fetch_doc
        self.budget.consume("ik_full_doc")
        cached = ik_asset_get(candidate.doc_id, increment_hit=True) or {}
        raw = cached.get("raw_api_response") or {}
        cached_text = str(raw.get("raw_content") or "")
        if len(cached_text) >= 500:
            candidate.full_text = cached_text
            candidate.metadata["doc_data"] = raw.get("doc_data") or {}
            candidate.metadata["_cache_hit"] = True
            return candidate
        document = ik_fetch_doc(candidate.doc_id, maxcites=5, maxcitedby=5) or {}
        record_ik_call(self.run_id, self.user_id, "document", endpoint=f"/doc/{candidate.doc_id}/", candidate_doc_id=candidate.doc_id, issue_id=candidate.matched_issue_id, success=bool(document))
        logger.debug("IK document response summary", extra={"details": {"run_id": self.run_id, "doc_id": candidate.doc_id, "chars": len(str(document.get("doc") or "")), "cite_count": len(document.get("cites") or document.get("citeList") or [])}})
        candidate.full_text = strip_html(str(document.get("doc") or ""))
        candidate.metadata["doc_data"] = document
        candidate.metadata["_cache_hit"] = False
        if len(candidate.full_text) >= 500:
            ik_asset_upsert(
                doc_id=candidate.doc_id,
                raw_api_response={"doc_id": candidate.doc_id, "doc_data": document, "raw_content": candidate.full_text},
                title=candidate.title or str(document.get("title") or ""),
                docsource=candidate.docsource or str(document.get("docsource") or ""),
                doc_char_count=len(candidate.full_text),
            )
        return candidate

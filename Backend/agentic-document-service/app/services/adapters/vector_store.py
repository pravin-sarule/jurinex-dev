from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.schemas.contracts import DocumentType
from app.services.adapters.embeddings import cosine_similarity


TOKEN_RE = re.compile(r"[a-zA-Z0-9_]+")


@dataclass(slots=True)
class ChunkRecord:
    chunk_id: str
    case_id: str
    document_id: str
    document_name: str
    doc_type: DocumentType
    text: str
    embedding: list[float]
    metadata: dict[str, str] = field(default_factory=dict)


class InMemoryVectorStore:
    def __init__(self) -> None:
        self._chunks: dict[str, list[ChunkRecord]] = {}

    def upsert_chunks(self, case_id: str, chunks: list[ChunkRecord]) -> None:
        self._chunks.setdefault(case_id, [])
        self._chunks[case_id].extend(chunks)

    def delete_document(self, document_id: str) -> int:
        """Remove all chunks for a document_id across all cases. Returns count removed."""
        removed = 0
        for case_id in list(self._chunks.keys()):
            before = len(self._chunks[case_id])
            self._chunks[case_id] = [
                c for c in self._chunks[case_id] if c.document_id != document_id
            ]
            removed += before - len(self._chunks[case_id])
        return removed

    def search(
        self,
        case_id: str,
        query: str,
        query_embedding: list[float],
        top_k: int,
        required_doc_types: list[DocumentType],
        *,
        use_hybrid_search: bool = True,
        use_rrf: bool = True,
        semantic_weight: float = 0.7,
        keyword_weight: float = 0.3,
    ) -> list[tuple[ChunkRecord, float]]:
        query_terms = set(TOKEN_RE.findall(query.lower()))
        semantic_matches: list[tuple[ChunkRecord, float]] = []
        keyword_matches: list[tuple[ChunkRecord, float]] = []
        for chunk in self._chunks.get(case_id, []):
            if required_doc_types and chunk.doc_type not in required_doc_types:
                continue
            text_terms = set(TOKEN_RE.findall(chunk.text.lower()))
            lexical_score = len(query_terms & text_terms) / max(len(query_terms), 1)
            vector_score = cosine_similarity(query_embedding, chunk.embedding)
            semantic_matches.append((chunk, vector_score))
            if use_hybrid_search:
                keyword_matches.append((chunk, lexical_score))

        semantic_matches.sort(key=lambda item: item[1], reverse=True)
        if not use_hybrid_search:
            return semantic_matches[:top_k]

        keyword_matches.sort(key=lambda item: item[1], reverse=True)
        if use_rrf:
            chunk_map: dict[str, tuple[ChunkRecord, float]] = {}
            rank_constant = 60.0
            for rank, (chunk, _score) in enumerate(semantic_matches[: max(top_k * 3, top_k)], start=1):
                chunk_map[chunk.chunk_id] = (chunk, 1.0 / (rank_constant + rank))
            for rank, (chunk, _score) in enumerate(keyword_matches[: max(top_k * 3, top_k)], start=1):
                existing = chunk_map.get(chunk.chunk_id)
                score = (existing[1] if existing else 0.0) + (1.0 / (rank_constant + rank))
                chunk_map[chunk.chunk_id] = (chunk, score)
            merged = list(chunk_map.values())
            merged.sort(key=lambda item: item[1], reverse=True)
            return merged[:top_k]

        semantic_weight = max(0.0, float(semantic_weight))
        keyword_weight = max(0.0, float(keyword_weight))
        chunk_scores: dict[str, tuple[ChunkRecord, float, float]] = {}
        for chunk, score in semantic_matches[: max(top_k * 3, top_k)]:
            chunk_scores[chunk.chunk_id] = (chunk, score, 0.0)
        for chunk, score in keyword_matches[: max(top_k * 3, top_k)]:
            existing = chunk_scores.get(chunk.chunk_id)
            if existing:
                chunk_scores[chunk.chunk_id] = (chunk, existing[1], score)
            else:
                chunk_scores[chunk.chunk_id] = (chunk, 0.0, score)
        merged = [
            (chunk, round((semantic * semantic_weight) + (keyword * keyword_weight), 4))
            for chunk, semantic, keyword in chunk_scores.values()
        ]
        merged.sort(key=lambda item: item[1], reverse=True)
        return merged[:top_k]

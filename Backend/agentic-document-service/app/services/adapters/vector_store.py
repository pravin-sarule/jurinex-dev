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

    def search(
        self,
        case_id: str,
        query: str,
        query_embedding: list[float],
        top_k: int,
        required_doc_types: list[DocumentType],
    ) -> list[tuple[ChunkRecord, float]]:
        query_terms = set(TOKEN_RE.findall(query.lower()))
        matches: list[tuple[ChunkRecord, float]] = []
        for chunk in self._chunks.get(case_id, []):
            if required_doc_types and chunk.doc_type not in required_doc_types:
                continue
            text_terms = set(TOKEN_RE.findall(chunk.text.lower()))
            lexical_score = len(query_terms & text_terms) / max(len(query_terms), 1)
            vector_score = cosine_similarity(query_embedding, chunk.embedding)
            score = round((lexical_score * 0.45) + (vector_score * 0.55), 4)
            matches.append((chunk, score))
        matches.sort(key=lambda item: item[1], reverse=True)
        return matches[:top_k]

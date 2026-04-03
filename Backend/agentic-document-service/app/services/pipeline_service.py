import logging
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
import re
from typing import Any

from app.core.config import Settings, get_settings
from app.schemas.contracts import (
    AnswerSegment,
    DocumentProcessResult,
    DocumentReference,
    DocumentType,
    ExtractedField,
    IngestDocumentsRequest,
    IngestDocumentsResponse,
    IntakeRequest,
    IntakeResponse,
    PresetExecutionRequest,
    PresetExecutionResponse,
    PresetPrompt,
    QueryCitation,
    QueryIntent,
    QueryRequest,
    QueryResponse,
)
from app.services.adapters import chunking, embeddings, ocr
from app.services.adapters.document_ai import DocumentAIAdapter, _call_gemini_for_qa
from app.services.adapters.vector_store import ChunkRecord, InMemoryVectorStore
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import get_llm_chat_config

logger = logging.getLogger("agentic_document_service.pipeline")


DEFAULT_PRESETS: list[dict[str, Any]] = [
    {
        "id": "case-brief",
        "name": "Case Brief",
        "prompt_template": (
            "Prepare a professional case brief using only the indexed case materials. "
            "Cover procedural posture, material facts, issues, party positions, court reasoning if available, "
            "and the current status. If any part is missing in the record, state that explicitly."
        ),
        "required_doc_types": ["pleading", "order", "affidavit", "correspondence"],
        "output_format": "structured",
    },
    {
        "id": "risk-scan",
        "name": "Risk Scan",
        "prompt_template": (
            "Identify the most important legal, procedural, evidentiary, and case-management risks from the record. "
            "Separate confirmed risks from possible risks, and mention missing documents or gaps that limit confidence."
        ),
        "required_doc_types": ["pleading", "evidence", "order", "affidavit", "correspondence"],
        "output_format": "structured",
    },
]


@dataclass(slots=True)
class StoredDocument:
    document_id: str
    document_name: str
    doc_type: DocumentType
    stored_document_uri: str
    text: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StoredCase:
    case_id: str
    user_id: str
    created_at: datetime
    documents: list[StoredDocument] = field(default_factory=list)
    form_data: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class ProcessedDocumentBundle:
    process_result: DocumentProcessResult
    stored_document: StoredDocument
    chunks: list[ChunkRecord]


class LegalCasePipelineService:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._cases: dict[str, StoredCase] = {}
        self._vector_store = InMemoryVectorStore()
        self._document_ai = DocumentAIAdapter()
        self._chunker = chunking.LegalSemanticChunker(
            target_tokens=self._settings.chunk_size,
            overlap_tokens=self._settings.chunk_overlap,
            min_tokens=self._settings.chunk_min_tokens,
            max_tokens=self._settings.chunk_max_tokens,
        )

    def _normalize_doc_type(self, value: Any) -> DocumentType | None:
        raw = str(value or "").strip().lower()
        if not raw:
            return None
        for item in DocumentType:
            if item.value == raw:
                return item
        return None

    def _coerce_doc_types(self, values: Any) -> list[DocumentType]:
        if values is None:
            return []
        if isinstance(values, str):
            values = [item.strip() for item in values.split(",")]
        result: list[DocumentType] = []
        for value in values:
            normalized = self._normalize_doc_type(value)
            if normalized and normalized not in result:
                result.append(normalized)
        return result

    def _fetch_presets_from_db(self) -> list[PresetPrompt]:
        if not is_db_available():
            return []
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                      id::text AS id,
                      name,
                      prompt_template,
                      required_doc_types,
                      output_format
                    FROM preset_prompts
                    WHERE is_active = TRUE
                    ORDER BY name ASC
                    """
                )
                rows = list(cur.fetchall())
        except Exception as exc:
            logger.warning("[Pipeline] preset_prompts lookup failed: %s", exc)
            return []

        presets: list[PresetPrompt] = []
        for row in rows:
            presets.append(
                PresetPrompt(
                    id=str(row.get("id") or ""),
                    name=str(row.get("name") or "Preset"),
                    prompt_template=str(row.get("prompt_template") or "").strip(),
                    required_doc_types=self._coerce_doc_types(row.get("required_doc_types")),
                    output_format=str(row.get("output_format") or "structured").strip() or "structured",
                )
            )
        return [preset for preset in presets if preset.prompt_template]

    def _get_default_presets(self) -> list[PresetPrompt]:
        return [
            PresetPrompt(
                id=item["id"],
                name=item["name"],
                prompt_template=item["prompt_template"],
                required_doc_types=self._coerce_doc_types(item.get("required_doc_types")),
                output_format=item.get("output_format") or "structured",
            )
            for item in DEFAULT_PRESETS
        ]

    def _infer_query_context(
        self,
        query: str,
        required_doc_types: list[DocumentType] | None = None,
    ) -> tuple[QueryIntent, list[DocumentType]]:
        raw = str(query or "").lower()
        inferred_types = list(required_doc_types or [])

        def add_doc_type(doc_type: DocumentType) -> None:
            if doc_type not in inferred_types:
                inferred_types.append(doc_type)

        if any(term in raw for term in ["timeline", "chronology", "sequence", "date wise", "procedural history"]):
            intent = QueryIntent.timeline
        elif any(term in raw for term in ["risk", "exposure", "weakness", "defect", "limitation", "vulnerability"]):
            intent = QueryIntent.risk
        elif any(term in raw for term in ["evidence", "exhibit", "proof", "annexure", "document support"]):
            intent = QueryIntent.evidence
        elif any(term in raw for term in ["summary", "summarize", "brief", "gist", "overview"]):
            intent = QueryIntent.summary
        else:
            intent = QueryIntent.general

        if any(term in raw for term in ["pleading", "petition", "plaint", "written statement", "reply", "rejoinder"]):
            add_doc_type(DocumentType.pleading)
        if any(term in raw for term in ["evidence", "exhibit", "annexure", "proof"]):
            add_doc_type(DocumentType.evidence)
        if any(term in raw for term in ["order", "judgment", "direction", "court order"]):
            add_doc_type(DocumentType.order)
        if any(term in raw for term in ["affidavit", "sworn statement"]):
            add_doc_type(DocumentType.affidavit)
        if any(term in raw for term in ["letter", "notice", "email", "correspondence", "communication"]):
            add_doc_type(DocumentType.correspondence)
        if any(term in raw for term in ["agreement", "contract", "clause"]):
            add_doc_type(DocumentType.contract)

        return intent, inferred_types

    def _build_grounded_answer(
        self,
        *,
        query: str,
        doc_texts: list[dict[str, str]],
        citations: list[QueryCitation],
        intent: QueryIntent,
        output_format: str = "plain",
        extra_instructions: str | None = None,
        system_instruction: str | None = None,
    ) -> tuple[str, bool]:
        qa_result = _call_gemini_for_qa(
            query,
            doc_texts,
            query_intent=intent.value,
            output_format=output_format,
            extra_instructions=extra_instructions,
            system_instruction=system_instruction,
        )
        synthesized_answer = (qa_result.get("answer") or "").strip()
        if synthesized_answer:
            return synthesized_answer, True
        fallback = "\n".join(
            f"{idx}. {citation.quote}" for idx, citation in enumerate(citations, start=1)
        ).strip()
        return fallback, False

    def process_intake(self, request: IntakeRequest) -> IntakeResponse:
        case_id = request.case_id or f"case-{uuid.uuid4().hex[:12]}"
        stored_case = self._cases.get(case_id)
        if not stored_case:
            stored_case = StoredCase(case_id=case_id, user_id=request.user_id, created_at=datetime.now(tz=UTC))
            self._cases[case_id] = stored_case

        extraction = self._document_ai.extract(request.document)
        form_data = dict(extraction.entities)
        stored_case.form_data.update(form_data)

        extracted_fields: list[ExtractedField] = []
        threshold = float(self._settings.auto_fill_confidence_threshold or 0.90)
        for field_name, field_value in form_data.items():
            confidence = float(extraction.confidence_by_field.get(field_name, 0.65))
            extracted_fields.append(
                ExtractedField(
                    name=field_name,
                    value=field_value,
                    confidence=confidence,
                    auto_filled=confidence >= threshold,
                )
            )

        return IntakeResponse(
            case_id=case_id,
            stored_document_uri=request.document.document_uri or "",
            schema_name=request.schema_name,
            extracted_fields=extracted_fields,
            form_data=stored_case.form_data,
            requires_review=any(not item.auto_filled for item in extracted_fields),
            created_at=datetime.now(tz=UTC),
        )

    def ingest_case_documents(self, request: IngestDocumentsRequest) -> IngestDocumentsResponse:
        stored_case = self._cases.get(request.case_id)
        if not stored_case:
            stored_case = StoredCase(case_id=request.case_id, user_id=request.user_id, created_at=datetime.now(tz=UTC))
            self._cases[request.case_id] = stored_case

        processed: list[DocumentProcessResult] = []
        total_chunks = 0
        for document in request.documents:
            bundle = self._process_single_document(request.case_id, document)
            logger.info(
                "[Pipeline] Step 4/4: Storing — case_id=%s chunks=%d (in-memory index)",
                request.case_id,
                len(bundle.chunks),
            )
            self._vector_store.upsert_chunks(request.case_id, bundle.chunks)
            logger.info("[Pipeline] Step 4/4: done — indexed for retrieval")
            stored_case.documents.append(bundle.stored_document)
            processed.append(bundle.process_result)
            total_chunks += len(bundle.chunks)

        return IngestDocumentsResponse(
            case_id=request.case_id,
            processed_documents=processed,
            total_chunks_indexed=total_chunks,
            completed_at=datetime.now(tz=UTC),
        )

    def _process_single_document(self, case_id: str, document: DocumentReference) -> ProcessedDocumentBundle:
        db_file_id = str(document.metadata.get("db_file_id") or "").strip()
        document_id = db_file_id if db_file_id else str(uuid.uuid4())
        mime_type = document.mime_type or "application/pdf"

        logger.info(
            "[Pipeline] %s | case_id=%s document_id=%s — start (OCR → chunking → embedding)",
            document.document_name,
            case_id,
            document_id,
        )

        text = (document.inline_text or "").strip()
        quality_score = 0.0
        page_count = 0
        if not text:
            if document.document_uri and document.document_uri.startswith("gs://"):
                logger.info(
                    "[Pipeline] Step 1/4: OCR / text extraction (GCS) uri=%s",
                    document.document_uri,
                )
                ocr_result = ocr.extract_text_from_gcs(document.document_uri, mime_type)
            else:
                logger.info("[Pipeline] Step 1/4: OCR / text extraction — no GCS URI, empty text")
                ocr_result = ocr.OcrResult(text="", page_count=0, quality_score=0.0)
            text = (ocr_result.text or "").strip()
            quality_score = float(ocr_result.quality_score or 0.0)
            page_count = int(ocr_result.page_count or 0)
            logger.info(
                "[Pipeline] Step 1/4: done — chars=%d pages=%d quality=%.2f",
                len(text),
                page_count,
                quality_score,
            )
        else:
            quality_score = 0.97 if len(text) > 100 else 0.55
            page_count = 1
            logger.info(
                "[Pipeline] Step 1/4: inline text (OCR skipped) — chars=%d",
                len(text),
            )

        doc_type = self._document_ai.classify(document, text)
        logger.info("[Pipeline] Document classified as %s", doc_type.value)

        logger.info("[Pipeline] Step 2/4: Chunking — semantic split")
        sections = self._chunker.chunk(text)
        chunk_rows: list[ChunkRecord] = []
        logger.info("[Pipeline] Step 2/4: done — %d raw sections", len(sections))

        non_empty = sum(1 for s in sections if (s.text or "").strip())
        logger.info("[Pipeline] Step 3/4: Embedding — %d non-empty chunks", non_empty)
        for section_idx, section in enumerate(sections):
            chunk_text = (section.text or "").strip()
            if not chunk_text:
                continue
            chunk_id = str(uuid.uuid4())
            chunk_embedding = embeddings.embed_text(chunk_text)
            chunk_rows.append(
                ChunkRecord(
                    chunk_id=chunk_id,
                    case_id=case_id,
                    document_id=document_id,
                    document_name=document.document_name,
                    doc_type=doc_type,
                    text=chunk_text,
                    embedding=chunk_embedding,
                    metadata={"heading": section.heading or "", "chunk_index": str(section_idx)},
                )
            )
        logger.info("[Pipeline] Step 3/4: done — %d vectors stored in bundle", len(chunk_rows))

        stored_document = StoredDocument(
            document_id=document_id,
            document_name=document.document_name,
            doc_type=doc_type,
            stored_document_uri=document.document_uri or document.metadata.get("gcs_path") or "",
            text=text,
            metadata=dict(document.metadata),
        )
        process_result = DocumentProcessResult(
            document_id=document_id,
            document_name=document.document_name,
            doc_type=doc_type,
            stored_document_uri=stored_document.stored_document_uri,
            extracted_text_chars=len(text),
            chunk_count=len(chunk_rows),
            quality_score=quality_score,
            metadata={
                **dict(document.metadata),
                "original_name": document.metadata.get("original_name") or document.document_name,
                "page_count": page_count,
                "heading_count": len([s for s in sections if s.heading]),
            },
        )
        return ProcessedDocumentBundle(process_result=process_result, stored_document=stored_document, chunks=chunk_rows)

    def persist_chunks_to_db(self, file_id: str | None, chunks: list[ChunkRecord]) -> list[ChunkRecord]:
        if not file_id or not chunks or not is_db_available():
            if file_id and chunks and not is_db_available():
                logger.info(
                    "[Pipeline] Step 4/4: Storing — DB unavailable, skipping persistence file_id=%s chunks=%d",
                    file_id,
                    len(chunks),
                )
            return chunks
        logger.info(
            "[Pipeline] Step 4/4: Storing — PostgreSQL file_chunks + chunk_vectors file_id=%s rows=%d",
            file_id,
            len(chunks),
        )
        persisted: list[ChunkRecord] = []
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                for index, chunk in enumerate(chunks):
                    cur.execute(
                        """
                        INSERT INTO file_chunks (file_id, chunk_index, content, token_count, page_start, page_end, heading)
                        VALUES (%s::uuid, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (file_id, chunk_index) DO UPDATE
                          SET content = EXCLUDED.content,
                              token_count = EXCLUDED.token_count,
                              page_start = EXCLUDED.page_start,
                              page_end = EXCLUDED.page_end,
                              heading = EXCLUDED.heading
                        RETURNING id
                        """,
                        (
                            file_id,
                            index,
                            chunk.text,
                            max(1, int(len(chunk.text.split()) * 1.3)),
                            None,
                            None,
                            chunk.metadata.get("heading") or None,
                        ),
                    )
                    chunk_row = cur.fetchone() or {}
                    db_chunk_id = str(chunk_row.get("id") or chunk.chunk_id)
                    embedding_pg = f"[{','.join(str(float(v)) for v in chunk.embedding)}]"
                    cur.execute(
                        """
                        INSERT INTO chunk_vectors (chunk_id, embedding, file_id)
                        VALUES (%s::uuid, %s::vector, %s::uuid)
                        ON CONFLICT (chunk_id) DO UPDATE
                          SET embedding = EXCLUDED.embedding,
                              file_id = EXCLUDED.file_id,
                              updated_at = NOW()
                        """,
                        (db_chunk_id, embedding_pg, file_id),
                    )
                    persisted.append(
                        ChunkRecord(
                            chunk_id=db_chunk_id,
                            case_id=chunk.case_id,
                            document_id=file_id,
                            document_name=chunk.document_name,
                            doc_type=chunk.doc_type,
                            text=chunk.text,
                            embedding=chunk.embedding,
                            metadata=chunk.metadata,
                        )
                    )
                conn.commit()
        except Exception as exc:
            logger.exception("[Pipeline] DB chunk/vector persistence failed file_id=%s error=%s", file_id, exc)
            return chunks
        logger.info(
            "[Pipeline] Step 4/4: done — persisted %d chunk rows for file_id=%s",
            len(persisted),
            file_id,
        )
        return persisted

    def _resolve_retrieval_params(self, request: QueryRequest, llm_config: dict[str, Any]) -> dict[str, Any]:
        return {
            "top_k": int(request.top_k or llm_config.get("retrieval_top_k") or self._settings.retrieval_top_k or 8),
            "max_context_documents": max(1, int(llm_config.get("max_context_documents") or 8)),
            "use_hybrid_search": bool(llm_config.get("use_hybrid_search")),
            "use_rrf": bool(llm_config.get("use_rrf")),
            "semantic_weight": max(0.0, float(llm_config.get("semantic_weight") or 0.7)),
            "keyword_weight": max(0.0, float(llm_config.get("keyword_weight") or 0.3)),
            "text_search_language": str(llm_config.get("text_search_language") or "english").strip() or "english",
        }

    def _log_retrieval_params(self, request: QueryRequest, llm_config: dict[str, Any], params: dict[str, Any], *, source: str) -> None:
        logger.info(
            "[RetrievalConfig] source=%s case_id=%s query=%s llm_model=%s summarization_model=%s embedding_model=%s "
            "top_k=%s max_context_documents=%s use_hybrid_search=%s use_rrf=%s semantic_weight=%s keyword_weight=%s "
            "text_search_language=%s max_output_tokens=%s max_summarization_output_tokens=%s model_temperature=%s streaming_delay=%s",
            source,
            request.case_id,
            request.query[:120],
            llm_config.get("llm_model"),
            llm_config.get("summarization_model"),
            llm_config.get("embedding_model"),
            params.get("top_k"),
            params.get("max_context_documents"),
            params.get("use_hybrid_search"),
            params.get("use_rrf"),
            params.get("semantic_weight"),
            params.get("keyword_weight"),
            params.get("text_search_language"),
            llm_config.get("max_output_tokens"),
            llm_config.get("max_summarization_output_tokens"),
            llm_config.get("model_temperature"),
            llm_config.get("streaming_delay"),
        )

    def _search_db_chunks(
        self,
        *,
        request: QueryRequest,
        valid_file_ids: list[str],
        query_embedding: list[float],
        params: dict[str, Any],
    ) -> list[dict[str, Any]]:
        top_k = int(params["top_k"])
        semantic_limit = max(top_k * 3, top_k)
        text_search_language = params["text_search_language"]
        keyword_query = self._build_keyword_query(request.query)
        embedding_pg = f"[{','.join(str(float(v)) for v in query_embedding)}]"
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  cv.chunk_id,
                  fc.content,
                  fc.file_id,
                  COALESCE(uf.originalname, fc.file_id::text) AS document_name,
                  (cv.embedding <=> %s::vector) AS distance,
                  (1 / (1 + (cv.embedding <=> %s::vector))) AS similarity
                FROM chunk_vectors cv
                INNER JOIN file_chunks fc ON cv.chunk_id::text = fc.id::text
                LEFT JOIN user_files uf ON uf.id::text = fc.file_id::text
                WHERE fc.file_id::text = ANY(%s::text[])
                ORDER BY distance ASC
                LIMIT %s
                """,
                (embedding_pg, embedding_pg, valid_file_ids, semantic_limit),
            )
            semantic_rows = list(cur.fetchall())

            keyword_rows: list[dict[str, Any]] = []
            if params["use_hybrid_search"] and keyword_query:
                try:
                    cur.execute(
                        """
                        SELECT
                          fc.id::text AS chunk_id,
                          fc.content,
                          fc.file_id,
                          COALESCE(uf.originalname, fc.file_id::text) AS document_name,
                          ts_rank_cd(
                            to_tsvector(%s::regconfig, COALESCE(fc.content, '')),
                            websearch_to_tsquery(%s::regconfig, %s)
                          ) AS keyword_score
                        FROM file_chunks fc
                        LEFT JOIN user_files uf ON uf.id::text = fc.file_id::text
                        WHERE fc.file_id::text = ANY(%s::text[])
                          AND to_tsvector(%s::regconfig, COALESCE(fc.content, '')) @@ websearch_to_tsquery(%s::regconfig, %s)
                        ORDER BY keyword_score DESC
                        LIMIT %s
                        """,
                        (
                            text_search_language,
                            text_search_language,
                            keyword_query,
                            valid_file_ids,
                            text_search_language,
                            text_search_language,
                            keyword_query,
                            semantic_limit,
                        ),
                    )
                    keyword_rows = list(cur.fetchall())
                except Exception as exc:
                    logger.warning(
                        "[Pipeline] DB keyword search skipped case_id=%s error=%s keyword_query=%r",
                        request.case_id,
                        exc,
                        keyword_query[:160],
                    )

        if not params["use_hybrid_search"]:
            return semantic_rows[:top_k]

        merged: dict[str, dict[str, Any]] = {}
        if params["use_rrf"]:
            rank_constant = 60.0
            for rank, row in enumerate(semantic_rows, start=1):
                entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
                entry["combined_score"] = float(entry.get("combined_score") or 0.0) + (1.0 / (rank_constant + rank))
            for rank, row in enumerate(keyword_rows, start=1):
                entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
                entry["combined_score"] = float(entry.get("combined_score") or 0.0) + (1.0 / (rank_constant + rank))
                entry["keyword_score"] = float(row.get("keyword_score") or 0.0)
            rows = list(merged.values())
            rows.sort(key=lambda item: float(item.get("combined_score") or 0.0), reverse=True)
            return rows[:top_k]

        semantic_weight = float(params["semantic_weight"])
        keyword_weight = float(params["keyword_weight"])
        for row in semantic_rows:
            entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
            entry["semantic_score"] = float(row.get("similarity") or 0.0)
        for row in keyword_rows:
            entry = merged.setdefault(str(row.get("chunk_id")), dict(row))
            entry["keyword_score"] = float(row.get("keyword_score") or 0.0)
        for entry in merged.values():
            entry["combined_score"] = (float(entry.get("semantic_score") or 0.0) * semantic_weight) + (
                float(entry.get("keyword_score") or 0.0) * keyword_weight
            )
        rows = list(merged.values())
        rows.sort(key=lambda item: float(item.get("combined_score") or 0.0), reverse=True)
        return rows[:top_k]

    def _build_keyword_query(self, raw_query: str) -> str:
        text = str(raw_query or "").strip()
        if not text:
            return ""
        current_question_match = re.search(r"current question:\s*(.+)$", text, flags=re.IGNORECASE | re.DOTALL)
        if current_question_match:
            text = current_question_match.group(1).strip()
        tokens = re.findall(r"[A-Za-z0-9_]{2,}", text.lower())
        deduped: list[str] = []
        seen: set[str] = set()
        for token in tokens:
            if token in seen:
                continue
            seen.add(token)
            deduped.append(token)
            if len(deduped) >= 24:
                break
        return " ".join(deduped)

    def answer_query_for_files(
        self,
        request: QueryRequest,
        file_ids: list[str],
        *,
        system_instruction: str | None = None,
    ) -> QueryResponse:
        valid_file_ids = [str(item) for item in file_ids if item]
        if not valid_file_ids or not is_db_available():
            return self.answer_query(request)

        llm_config = get_llm_chat_config()
        retrieval_params = self._resolve_retrieval_params(request, llm_config)
        self._log_retrieval_params(request, llm_config, retrieval_params, source="db")
        intent, _effective_required_doc_types = self._infer_query_context(request.query, request.required_doc_types)
        query_embedding = embeddings.embed_text(request.query)
        try:
            rows = self._search_db_chunks(
                request=request,
                valid_file_ids=valid_file_ids,
                query_embedding=query_embedding,
                params=retrieval_params,
            )
        except Exception as exc:
            logger.exception("[Pipeline] DB vector search failed case_id=%s error=%s", request.case_id, exc)
            raise ValueError(f"Indexed search failed for case '{request.case_id}'.") from exc

        if not rows:
            raise ValueError(f"No indexed chunks found for case '{request.case_id}'.")

        citations: list[QueryCitation] = []
        answer_lines: list[str] = []
        for rank, row in enumerate(rows, start=1):
            quote = " ".join(str(row.get("content") or "").split())[:320]
            citations.append(
                QueryCitation(
                    document_id=str(row.get("file_id") or ""),
                    document_name=str(row.get("document_name") or "document"),
                    chunk_id=str(row.get("chunk_id") or ""),
                    quote=quote,
                    score=float(row.get("combined_score") or row.get("similarity") or row.get("keyword_score") or 0.0),
                )
            )
            answer_lines.append(f"{rank}. {quote}")

        doc_texts = []
        for row in rows:
            content = str(row.get("content") or "").strip()
            if not content:
                continue
            doc_texts.append(
                {
                    "name": str(row.get("document_name") or "document"),
                    "text": content,
                }
            )
        max_context_documents = int(retrieval_params["max_context_documents"])
        answer_text, grounded = self._build_grounded_answer(
            query=request.query,
            doc_texts=doc_texts[:max_context_documents],
            citations=citations,
            intent=intent,
            output_format="structured",
            system_instruction=system_instruction,
        )
        segment = AnswerSegment(statement=answer_text, confidence=0.9 if grounded else 0.72, citations=citations)
        return QueryResponse(
            case_id=request.case_id,
            intent=intent,
            answer=answer_text,
            answer_segments=[segment],
            hallucination_check_passed=grounded,
            retrieved_chunk_count=len(rows),
            generated_at=datetime.now(tz=UTC),
        )

    def answer_query(self, request: QueryRequest) -> QueryResponse:
        case = self._cases.get(request.case_id)
        if not case:
            raise ValueError(f"Case '{request.case_id}' not found.")

        llm_config = get_llm_chat_config()
        retrieval_params = self._resolve_retrieval_params(request, llm_config)
        self._log_retrieval_params(request, llm_config, retrieval_params, source="memory")
        intent, effective_required_doc_types = self._infer_query_context(request.query, request.required_doc_types)
        query_embedding = embeddings.embed_text(request.query)
        hits = self._vector_store.search(
            case_id=request.case_id,
            query=request.query,
            query_embedding=query_embedding,
            top_k=int(retrieval_params["top_k"]),
            required_doc_types=effective_required_doc_types,
            use_hybrid_search=bool(retrieval_params["use_hybrid_search"]),
            use_rrf=bool(retrieval_params["use_rrf"]),
            semantic_weight=float(retrieval_params["semantic_weight"]),
            keyword_weight=float(retrieval_params["keyword_weight"]),
        )
        if not hits:
            raise ValueError(f"No indexed chunks found for case '{request.case_id}'.")

        citations: list[QueryCitation] = []
        answer_lines: list[str] = []
        for rank, (chunk, score) in enumerate(hits, start=1):
            quote = " ".join(chunk.text.split())[:320]
            citations.append(
                QueryCitation(
                    document_id=chunk.document_id,
                    document_name=chunk.document_name,
                    chunk_id=chunk.chunk_id,
                    quote=quote,
                    score=float(score),
                )
            )
            answer_lines.append(f"{rank}. {quote}")

        doc_texts = [
            {"name": chunk.document_name or "document", "text": chunk.text}
            for chunk, _score in hits
            if (chunk.text or "").strip()
        ]
        max_context_documents = int(retrieval_params["max_context_documents"])
        answer_text, grounded = self._build_grounded_answer(
            query=request.query,
            doc_texts=doc_texts[:max_context_documents],
            citations=citations,
            intent=intent,
            output_format="structured",
        )
        segment = AnswerSegment(statement=answer_text, confidence=0.9 if grounded else 0.72, citations=citations)
        return QueryResponse(
            case_id=request.case_id,
            intent=intent,
            answer=answer_text,
            answer_segments=[segment],
            hallucination_check_passed=grounded,
            retrieved_chunk_count=len(hits),
            generated_at=datetime.now(tz=UTC),
        )

    def list_presets(self) -> list[PresetPrompt]:
        presets = self._fetch_presets_from_db()
        return presets or self._get_default_presets()

    def execute_preset(self, request: PresetExecutionRequest) -> PresetExecutionResponse:
        preset = next((item for item in self.list_presets() if item.id == request.preset_id), None)
        if not preset:
            raise ValueError(f"Preset '{request.preset_id}' was not found.")
        additional_context = (request.additional_context or "").strip()
        effective_query = preset.prompt_template
        if additional_context:
            effective_query = f"{effective_query}\n\n=== ADDITIONAL USER INSTRUCTIONS ===\n{additional_context}"
        result = self.answer_query(
            QueryRequest(
                user_id=request.user_id,
                case_id=request.case_id,
                query=effective_query,
                required_doc_types=preset.required_doc_types,
            )
        )
        return PresetExecutionResponse(
            preset_id=preset.id,
            preset_name=preset.name,
            case_id=request.case_id,
            output_format=preset.output_format,
            rendered_prompt=None,
            result=result,
        )


def get_pipeline_service() -> LegalCasePipelineService:
    return LegalCasePipelineService(get_settings())

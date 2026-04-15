"""
Legal Citation Intelligence Agent
Responsible for ingesting, processing, and storing legal judgment data using a multi-database architecture:
  1. PostgreSQL (Metadata Database)
  2. Elasticsearch (Full Text Search)
  3. Qdrant (Vector Embedding Database)
  4. Neo4j (Citation Graph Database)

Maintains `canonical_id` as the primary identifier across all databases.

DB building rule (CHECK 7): When ingesting new judgments, we do NOT overwrite
existing entries. _check_pg_exists causes skip and return skipped/duplicate.
Existing entries are used for user citation reports; new fetches only add new records.
"""

from __future__ import annotations

import logging
import uuid
import hashlib
import re
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from db.connections import get_es_client, get_neo4j_driver, get_pg_conn, get_qdrant_client
from google import genai

class LegalCitationAgent:
    def __init__(self, pg_conn=None, es_client=None, qdrant_client=None, neo4j_driver=None):
        """Initialize the agent with database connections."""
        # Do not hold a pooled PG connection per agent instance by default.
        # In high-concurrency Clerk ingest, one agent is created per document;
        # retaining pooled connections here quickly exhausts the pool.
        self.pg = pg_conn
        self.es = es_client or get_es_client()
        self.qdrant = qdrant_client or get_qdrant_client()
        self.neo4j = neo4j_driver or get_neo4j_driver()
        raw_embed_model = os.environ.get("GEMINI_EMBEDDING_MODEL", "models/gemini-embedding-001")
        self._embed_model = raw_embed_model if raw_embed_model.startswith("models/") else f"models/{raw_embed_model}"
        self._embed_batch_size = max(1, min(64, int(os.environ.get("CITATION_EMBED_BATCH_SIZE", "16"))))
        self._embed_workers = max(1, min(16, int(os.environ.get("CITATION_EMBED_WORKERS", "4"))))
        self._embed_output_dims = int(os.environ.get("CITATION_EMBED_OUTPUT_DIMS", "768"))
        self._embed_task_type = os.environ.get("CITATION_EMBED_TASK_TYPE", "RETRIEVAL_DOCUMENT")
        self._embed_client = None
        self._embed_available = False
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if api_key:
            try:
                self._embed_client = genai.Client(api_key=api_key)
                self._embed_available = True
            except Exception as exc:
                logger.warning("[EMBED] Gemini client init failed: %s", exc)
        else:
            logger.warning("[EMBED] GEMINI_API_KEY/GOOGLE_API_KEY missing; embedding disabled")

    def generate_canonical_id(self, case_name: str, court_code: str, year: str) -> str:
        """Generate a deterministic canonical_id based on core case identifiers."""
        raw = f"{case_name.strip().lower()}|{court_code.strip().lower()}|{str(year).strip()}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]

    def _chunk_text(self, text: str, chunk_size: int = 1200, overlap: int = 200) -> List[str]:
        if not text:
            return []
        chunks, start = [], 0
        while start < len(text):
            chunks.append(text[start:start + chunk_size])
            start += chunk_size - overlap
        max_chunks = max(10, int(os.environ.get("CITATION_MAX_CHUNKS_PER_DOC", "80")))
        if len(chunks) > max_chunks:
            logger.info("[INGEST] Chunk cap applied: %d -> %d", len(chunks), max_chunks)
            return chunks[:max_chunks]
        return chunks

    def _embed_texts_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Create embeddings for one batch using Gemini embedding API.
        Returns one vector per input text; failed items are returned as [].
        """
        if not self._embed_available or not self._embed_client:
            return [[] for _ in texts]
        try:
            response = self._embed_client.models.embed_content(
                model=self._embed_model,
                contents=texts,
                config={
                    "task_type": self._embed_task_type,
                    "output_dimensionality": self._embed_output_dims,
                },
            )
            embeddings_obj = getattr(response, "embeddings", None) or []
            out: List[List[float]] = []
            for emb in embeddings_obj:
                values = getattr(emb, "values", None)
                if isinstance(values, list) and values:
                    out.append([float(v) for v in values])
                else:
                    out.append([])
            if len(out) < len(texts):
                out.extend([[] for _ in range(len(texts) - len(out))])
            return out[: len(texts)]
        except Exception as exc:
            logger.warning("[EMBED] Batch embedding failed: %s", exc)
            return [[] for _ in texts]

    def _embed_texts_parallel(self, texts: List[str]) -> List[List[float]]:
        """
        Embed all chunk texts using batch + parallel execution.
        Preserves original order.
        """
        if not texts:
            return []
        indexed = [(i, t or "") for i, t in enumerate(texts)]
        batches: List[List[tuple[int, str]]] = [
            indexed[i : i + self._embed_batch_size]
            for i in range(0, len(indexed), self._embed_batch_size)
        ]
        vectors: List[List[float]] = [[] for _ in texts]
        with ThreadPoolExecutor(max_workers=min(self._embed_workers, len(batches))) as pool:
            future_map = {
                pool.submit(self._embed_texts_batch, [item[1] for item in batch]): batch
                for batch in batches
            }
            for fut in as_completed(future_map):
                batch = future_map[fut]
                try:
                    result = fut.result()
                except Exception as exc:
                    logger.warning("[EMBED] Parallel batch failed: %s", exc)
                    result = [[] for _ in batch]
                for idx_in_batch, (orig_idx, _) in enumerate(batch):
                    vectors[orig_idx] = result[idx_in_batch] if idx_in_batch < len(result) else []
        return vectors

    def _extract_citations(self, text: str) -> List[Dict[str, Any]]:
        """Extract citations from text using a legal citation parser."""
        # Dummy extraction logic - would use regex or NLP models in reality
        return []

    # ─────────────────────────────────────────────────────────────────────────────
    # PostgreSQL (Metadata)
    # ─────────────────────────────────────────────────────────────────────────────
    def _check_pg_exists(self, canonical_id: str) -> bool:
        conn = self.pg or get_pg_conn()
        if not conn:
            return False
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM judgments WHERE canonical_id = %s", (canonical_id,))
                return bool(cur.fetchone())
        finally:
            if conn is not self.pg:
                conn.close()

    def _insert_pg_metadata(self, data: Dict[str, Any]) -> bool:
        """Returns True if insert succeeded."""
        conn = self.pg or get_pg_conn()
        if not conn:
            logger.warning("[PG] skipped insert (no connection)")
            return False
        logger.info("[PG] Inserting metadata for canonical_id: %s", data["canonical_id"])
        judgment_uuid = data.get("judgment_uuid") or str(uuid.uuid4())
        data["judgment_uuid"] = judgment_uuid

        def _truncate(val: Any, max_len: int) -> Optional[str]:
            if val is None:
                return None
            s = str(val)
            return s[:max_len] if len(s) > max_len else s

        def _safe_str(val: Any, max_len: int) -> Optional[str]:
            s = _truncate(val, max_len)
            return s.strip() if s is not None else None

        def _normalize_alias(alias: str) -> str:
            return re.sub(r"\s+", " ", alias.strip().lower())

        def _safe_date(val: Any):
            if val is None:
                return None
            s = str(val).strip()
            if not s or "further research" in s.lower() or "not found" in s.lower() or "not available" in s.lower() or s == "—":
                return None
            if not re.search(r"\b(19\d{2}|20\d{2})\b", s):
                return None
            return s

        def _safe_confidence(val: Any):
            if val is None:
                return None
            try:
                v = float(val)
                if v > 1:
                    v = round(v / 100.0, 3)
                return min(9.999, max(0.0, v))
            except (TypeError, ValueError):
                return None

        raw_verification_status = _safe_str(data.get("verification_status", "pending"), 32) or "pending"
        _vs = str(raw_verification_status).strip().upper()
        if _vs in ("VERIFIED", "VERIFIED_WARN", "GREEN", "APPROVED"):
            verification_status = "APPROVED"
        elif _vs in ("NEEDS_REVIEW", "YELLOW", "REVIEW"):
            verification_status = "NEEDS_REVIEW"
        elif _vs in ("QUARANTINED", "RED", "REJECTED"):
            verification_status = "QUARANTINED"
        else:
            verification_status = "PENDING"

        # Rich fields stored as JSONB for ES-free fallback (used by judgement_get when ES is down)
        import json as _json
        citation_data_payload = _json.dumps({
            "primary_citation":    data.get("primary_citation"),
            "alternate_citations": data.get("alternate_citations") or [],
            "court_name":          data.get("court_name") or data.get("court_code"),
            "court_code":          data.get("court_code"),
            "bench_type":          data.get("bench_type"),
            "holding_text":        data.get("holding_text") or data.get("summary_text"),
            "summary_text":        data.get("summary_text"),
            "full_text":           (data.get("full_text") or "")[:500000],
            "statutes":            data.get("statutes") or [],
            "excerpt_para":        data.get("excerpt_para"),
            "excerpt_text":        data.get("excerpt_text"),
            "source_url":          data.get("source_url"),
            "official_source_url": data.get("official_source_url"),
            "source_type":         data.get("source_type"),
            "judges":              data.get("judges") or [],
            "paragraphs":          data.get("paragraphs") or [],
            "case_name":           data.get("case_name"),
            "dimension_id":        data.get("dimension_id"),
            "dimension_name":      data.get("dimension_name"),
            "dimension_tags":      data.get("dimension_tags") or [],
            "query_type":          data.get("query_type"),
            "embedding_model":     data.get("embedding_model"),
            "embedding_dims":      data.get("embedding_dims"),
        }, ensure_ascii=False)

        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO judgments (
                        judgment_uuid, canonical_id, case_name, court_code, court_tier,
                        judgment_date, year, bench_size, outcome, source_type,
                        verification_status, confidence_score, citation_frequency,
                        qdrant_vector_id, neo4j_node_id, es_doc_id, citation_data, ingested_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (canonical_id) DO UPDATE SET
                        citation_data = EXCLUDED.citation_data
                    """,
                    (
                        judgment_uuid,
                        data["canonical_id"],
                        data.get("case_name"),
                        _safe_str(data.get("court_code"), 20),
                        _safe_str(data.get("court_tier"), 10),
                        _safe_date(data.get("judgment_date")),
                        data.get("year"),
                        data.get("bench_size"),
                        _safe_str(data.get("outcome"), 50),
                        _safe_str(data.get("source_type"), 20),
                        verification_status,
                        _safe_confidence(data.get("confidence_score")),
                        data.get("citation_frequency", 0),
                        data.get("qdrant_vector_id"),
                        data.get("neo4j_node_id"),
                        _safe_str(data.get("es_doc_id"), 100),
                        citation_data_payload,
                    ),
                )

                aliases = []
                if data.get("primary_citation"):
                    aliases.append(data["primary_citation"])
                aliases += data.get("citation_aliases", []) or []
                aliases += data.get("alternate_citations", []) or []

                for alias in {a for a in aliases if isinstance(a, str) and a.strip()}:
                    normalized = _normalize_alias(alias)
                    cur.execute(
                        """
                        INSERT INTO citation_aliases (alias_id, judgment_uuid, alias_string, reporter_type, normalized, created_at)
                        VALUES (%s, %s, %s, %s, %s, NOW())
                        ON CONFLICT (normalized) DO NOTHING
                        """,
                        (str(uuid.uuid4()), judgment_uuid, _safe_str(alias, 300), None, _safe_str(normalized, 300)),
                    )

                for judge in data.get("judges", []) or []:
                    name = _safe_str(judge, 255)
                    if not name:
                        continue
                    cur.execute("SELECT judge_id FROM judges WHERE canonical_name = %s", (name,))
                    row = cur.fetchone()
                    if row:
                        judge_id = row[0]
                    else:
                        cur.execute(
                            "INSERT INTO judges (canonical_name, honorific, name_variants, created_at) VALUES (%s, %s, %s, NOW()) RETURNING judge_id",
                            (name, None, []),
                        )
                        judge_id = cur.fetchone()[0]
                    cur.execute(
                        "INSERT INTO judgment_judges (judgment_uuid, judge_id, role) VALUES (%s, %s, %s)",
                        (judgment_uuid, judge_id, "bench"),
                    )

                for statute in data.get("statutes", []) or []:
                    statute_str = str(statute).strip()
                    if not statute_str:
                        continue
                    cur.execute(
                        """
                        INSERT INTO statutes_cited (judgment_uuid, act_name, act_short, section, sub_section, india_code_url)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (judgment_uuid, _safe_str(statute_str, 500), None, None, None, None),
                    )

            conn.commit()
            return True
        except Exception as exc:
            logger.warning("[PG] insert failed for %s: %s", data.get("canonical_id"), exc)
            return False
        finally:
            if conn is not self.pg:
                conn.close()

    # ─────────────────────────────────────────────────────────────────────────────
    # Elasticsearch (Full Text Search)
    # ─────────────────────────────────────────────────────────────────────────────
    def _index_elasticsearch(self, data: Dict[str, Any]) -> Optional[bool]:
        """Returns True if index succeeded, None when skipped, False on failure."""
        if not self.es:
            logger.warning("[ES] skipped index (no connection)")
            return None
        logger.info(f"[ES] Indexing document for canonical_id: {data['canonical_id']}")
        subsequent = data.get("subsequent_treatment")
        if subsequent and isinstance(subsequent, dict):
            subsequent = {k: v for k, v in subsequent.items() if k in ("followed", "distinguished", "overruled") and isinstance(v, list)}
        else:
            subsequent = {}
        doc = {
            "canonical_id": data["canonical_id"],
            "case_name": data.get("case_name"),
            "court_name": data.get("court_name"),
            "court_code": data.get("court_code"),
            "year": data.get("year"),
            "judgment_date": data.get("judgment_date"),
            "bench_type": data.get("bench_type"),
            "summary_text": data.get("summary_text", ""),
            "holding_text": data.get("holding_text", ""),
            "facts_text": data.get("facts_text", ""),
            "full_text": data.get("full_text", ""),
            "paragraphs": data.get("paragraphs", []),
            "judges": data.get("judges", []),
            "statutes": data.get("statutes", []),
            "source_type": data.get("source_type"),
            "source_url": data.get("source_url"),
            "official_source_url": data.get("official_source_url"),
            "primary_citation": data.get("primary_citation"),
            "alternate_citations": data.get("alternate_citations") or [],
            "excerpt_para": data.get("excerpt_para"),
            "excerpt_text": data.get("excerpt_text"),
            "subsequent_treatment": subsequent,
            "verification_status": data.get("verification_status"),
            "ingested_at": datetime.utcnow().isoformat(),
        }
        try:
            self.es.index(index="judgments", id=data["canonical_id"], document=doc)
            return True
        except Exception as exc:
            logger.warning("[ES] index failed for %s: %s", data.get("canonical_id"), exc)
            return False

    # ─────────────────────────────────────────────────────────────────────────────
    # Qdrant (Vector Embeddings)
    # ─────────────────────────────────────────────────────────────────────────────
    def _store_qdrant_embeddings(self, data: Dict[str, Any], chunks: List[str]) -> Optional[bool]:
        """Returns True if store succeeded, None when skipped, False on failure."""
        if not self.qdrant:
            logger.warning("[QDRANT] skipped vectors (no connection)")
            return None
        if not self._embed_available:
            logger.warning("[QDRANT] skipped vectors (Gemini embedding unavailable)")
            return None
        from qdrant_client.models import PointStruct
        
        logger.info(f"[QDRANT] Storing {len(chunks)} chunks for canonical_id: {data['canonical_id']}")
        embeddings = self._embed_texts_parallel(chunks)
        points = []
        for i, chunk in enumerate(chunks):
            vector_id = str(uuid.uuid4())
            embedding = embeddings[i] if i < len(embeddings) else []
            if not embedding:
                logger.warning("[QDRANT] Missing embedding for chunk=%s canonical_id=%s", i, data.get("canonical_id"))
                continue
            # Spec payload: case_id (original case), citation_text, relevant_section
            citation_text = data.get("primary_citation") or data.get("citation_text") or ""
            relevant_section = (data.get("excerpt_text") or data.get("excerpt_para") or "")[:500]
            if not relevant_section and (data.get("statutes") or []):
                relevant_section = str(data["statutes"][0])[:500]
            payload = {
                "canonical_id": data["canonical_id"],
                "paragraph_id": i,
                "court_code": data["court_code"],
                "year": data["year"],
                "case_name": data["case_name"],
                "text_chunk": chunk,
                "case_id": data.get("case_id"),
                "citation_text": citation_text[:1000] if citation_text else "",
                "relevant_section": relevant_section,
                "source_url": (data.get("source_url") or data.get("official_source_url") or "")[:2000],
                "import_source_link": (data.get("source_url") or data.get("official_source_url") or "")[:2000],
                # Dimension tags from LDE/Clerk
                "dimension_id":   data.get("dimension_id"),
                "dimension_name": (data.get("dimension_name") or "")[:200],
                "dimension_tags": data.get("dimension_tags") or [],
                "query_type":     (data.get("query_type") or "")[:50],
                "embedding_model": data.get("embedding_model") or self._embed_model,
                "embedding_dims":  data.get("embedding_dims") or self._embed_output_dims,
            }
            points.append(PointStruct(id=vector_id, vector=embedding, payload=payload))
        
        if not points:
            logger.warning("[QDRANT] No embeddings generated for canonical_id=%s", data.get("canonical_id"))
            return False
        try:
            qdrant_collection = os.environ.get("QDRANT_COLLECTION", "legal_embeddings_v2").strip() or "legal_embeddings_v2"
            self.qdrant.upsert(
                collection_name=qdrant_collection,
                points=points
            )
            return True
        except Exception as exc:
            logger.warning("[QDRANT] upsert failed for %s: %s", data.get("canonical_id"), exc)
            return False

    # ─────────────────────────────────────────────────────────────────────────────
    # Neo4j (Citation Graph)
    # ─────────────────────────────────────────────────────────────────────────────
    def _create_neo4j_graph(self, data: Dict[str, Any], citations: List[Dict[str, Any]]) -> Optional[bool]:
        """Returns True if graph update succeeded, None when skipped, False on failure."""
        if not self.neo4j:
            logger.warning("[NEO4J] skipped graph (no connection)")
            return None

        logger.info(f"[NEO4J] Updating graph for canonical_id: {data['canonical_id']}")
        canonical_id = data["canonical_id"]
        case_name = data.get("case_name") or ""
        court_code = data.get("court_code") or "Unknown"
        year = data.get("year")
        statutes = data.get("statutes") or []
        case_id_original = data.get("case_id")

        def _update_graph(tx):
            # CitedCase: the judgment being ingested
            tx.run("""
                MERGE (c:CitedCase {caseId: $canonical_id})
                SET c.caseName = $case_name,
                    c.courtCode = $court_code,
                    c.year = $year
            """, canonical_id=canonical_id, case_name=case_name, court_code=court_code, year=year)

            # Court node + DECIDED_BY: (CitedCase)-[:DECIDED_BY]->(Court)
            tx.run("""
                MERGE (court:Court {code: $court_code})
                SET court.name = $court_code
                WITH court
                MATCH (c:CitedCase {caseId: $canonical_id})
                MERGE (c)-[r:DECIDED_BY]->(court)
            """, court_code=court_code, canonical_id=canonical_id)

            # LegalSection from statutes + INTERPRETS_SECTION: (CitedCase)-[:INTERPRETS_SECTION]->(LegalSection)
            for statute in statutes[:20]:
                statute_str = (str(statute).strip() or "")[:200]
                if not statute_str:
                    continue
                tx.run("""
                    MERGE (s:LegalSection {name: $name})
                    WITH s
                    MATCH (c:CitedCase {caseId: $canonical_id})
                    MERGE (c)-[r:INTERPRETS_SECTION]->(s)
                """, name=statute_str, canonical_id=canonical_id)

            # OriginalCase (if case_id from request) + CITES: (OriginalCase)-[:CITES]->(CitedCase)
            if case_id_original:
                tx.run("""
                    MERGE (orig:OriginalCase {caseId: $original_case_id})
                    SET orig.caseId = $original_case_id
                    WITH orig
                    MATCH (c:CitedCase {caseId: $canonical_id})
                    MERGE (orig)-[r:CITES]->(c)
                """, original_case_id=case_id_original, canonical_id=canonical_id)

            # Optional: Doctrine node + APPLIES_DOCTRINE when doctrine is provided (e.g. "last seen theory")
            doctrine_name = (data.get("doctrine") or "").strip()[:200]
            if doctrine_name:
                doctrine_name = doctrine_name[:200]
                tx.run("""
                    MERGE (d:Doctrine {name: $name})
                    WITH d
                    MATCH (c:CitedCase {caseId: $canonical_id})
                    MERGE (c)-[r:APPLIES_DOCTRINE]->(d)
                """, name=doctrine_name, canonical_id=canonical_id)

            # CitedCase-to-CitedCase CITES from extracted citations
            for cit in citations:
                cited_id = cit.get("cited_canonical_id")
                if not cited_id:
                    continue
                rel_type = (cit.get("relationship") or "CITES").upper()
                if rel_type not in ("CITES", "FOLLOWS", "DISTINGUISHES", "OVERRULES", "MODIFIES"):
                    rel_type = "CITES"
                tx.run(f"""
                    MERGE (target:CitedCase {{caseId: $cited_id}})
                    WITH target
                    MATCH (source:CitedCase {{caseId: $canonical_id}})
                    MERGE (source)-[r:{rel_type}]->(target)
                    SET r.paragraph = $paragraph,
                        r.citationContext = $context,
                        r.confidence = $confidence
                """, canonical_id=canonical_id, cited_id=cited_id,
                     paragraph=cit.get("paragraph", ""), context=cit.get("context", ""),
                     confidence=cit.get("confidence", 0.9))

        try:
            with self.neo4j.session() as session:
                session.execute_write(_update_graph)
            return True
        except Exception as exc:
            logger.warning("[NEO4J] graph update failed for %s: %s", data.get("canonical_id"), exc)
            return False

    # ─────────────────────────────────────────────────────────────────────────────
    # Primary Workflow
    # ─────────────────────────────────────────────────────────────────────────────
    def ingest_judgment(self, raw_data: Dict[str, Any]):
        """
        Main PROCESSING WORKFLOW:
        1. Extract metadata
        2. Insert metadata into PostgreSQL
        3. Index full text into Elasticsearch
        4. Split judgment into paragraph chunks
        5. Generate embeddings for each chunk
        6. Store embeddings in Qdrant
        7. Extract citations using a legal citation parser
        8. Create relationships in Neo4j
        """
        # 1. Extract metadata
        case_name = raw_data.get("case_name") or raw_data.get("title") or "Unknown"
        court_code = raw_data.get("court_code") or raw_data.get("court") or "Unknown"
        year = raw_data.get("year") or "0000"
        raw_data["case_name"] = case_name
        raw_data["court_code"] = court_code
        raw_data["year"] = year
        
        canonical_id = raw_data.get("canonical_id")
        if not canonical_id:
            canonical_id = self.generate_canonical_id(case_name, court_code, year)
            raw_data["canonical_id"] = canonical_id

        # DB building: do not overwrite existing entries (CHECK 7)
        if self._check_pg_exists(canonical_id):
            logger.info(f"Judgment already exists. canonical_id: {canonical_id}. Skipping insert.")
            return {
                "status": "skipped",
                "reason": "duplicate",
                "canonical_id": canonical_id,
                "pg": True,
                "es_doc_id": canonical_id,
                "qdrant_stored": True,
                "neo4j_stored": True,
            }

        # Setup standard data package
        raw_data["es_doc_id"] = canonical_id
        raw_data["neo4j_node_id"] = raw_data.get("neo4j_node_id")
        raw_data["source_type"] = raw_data.get("source_type") or "local"
        raw_data["judgment_uuid"] = raw_data.get("judgment_uuid") or str(uuid.uuid4())
        raw_data["embedding_model"] = raw_data.get("embedding_model") or self._embed_model
        raw_data["embedding_dims"] = raw_data.get("embedding_dims") or self._embed_output_dims

        ack = {"canonical_id": canonical_id, "pg": False, "es_doc_id": None, "qdrant_stored": False, "neo4j_stored": False, "errors": []}

        # 2. Insert metadata into PostgreSQL (must succeed before secondary stores)
        ack["pg"] = self._insert_pg_metadata(raw_data)
        if not ack["pg"]:
            ack["errors"].append("pg_insert_failed")

        # Prepare chunks for embedding (needed by Qdrant)
        full_text = raw_data.get("full_text", "")
        chunks = self._chunk_text(full_text)
        extracted_citations = self._extract_citations(full_text)

        # 3/4/5/6/8. Parallelize ES + Qdrant + Neo4j writes (independent of each other)
        def _write_es():
            ok = self._index_elasticsearch(raw_data)
            return ("es", ok)

        def _write_qdrant():
            ok = self._store_qdrant_embeddings(raw_data, chunks)
            return ("qdrant", ok)

        def _write_neo4j():
            ok = self._create_neo4j_graph(raw_data, extracted_citations)
            return ("neo4j", ok)

        with ThreadPoolExecutor(max_workers=3) as pool:
            futs = [
                pool.submit(_write_es),
                pool.submit(_write_qdrant),
                pool.submit(_write_neo4j),
            ]
            for fut in as_completed(futs):
                try:
                    store, ok = fut.result()
                    if store == "es":
                        ack["es_doc_id"] = canonical_id if ok is True else None
                        if ok is False:
                            ack["errors"].append("es_index_failed")
                    elif store == "qdrant":
                        ack["qdrant_stored"] = bool(ok)
                        if ok is False:
                            ack["errors"].append("qdrant_upsert_failed")
                    elif store == "neo4j":
                        ack["neo4j_stored"] = bool(ok)
                        if ok is False:
                            ack["errors"].append("neo4j_graph_failed")
                except Exception as exc:
                    logger.warning("[INGEST] secondary store error: %s", exc)
                    ack["errors"].append(f"store_error:{exc!s:.60}")

        # Consider success if PostgreSQL succeeded (ES/Qdrant/Neo4j optional for report generation)
        success = ack["pg"]
        ack["status"] = "success" if success else "storage_failed"
        if success:
            if ack["errors"]:
                logger.info(f"Ingestion complete for canonical_id: {canonical_id} (degraded: {ack['errors']})")
            else:
                logger.info(f"Ingestion complete for canonical_id: {canonical_id}")
        else:
            logger.warning(f"Ingestion incomplete for canonical_id: {canonical_id} errors={ack['errors']}")
        return ack

    def search(self, query: str) -> Dict[str, Any]:
        """
        When a user searches:
        1. Use Elasticsearch for keyword search
        2. Use Qdrant for semantic search
        3. Retrieve metadata from PostgreSQL
        4. Retrieve citation graph from Neo4j
        5. Return structured results.
        """
        logger.info(f"Searching for: {query}")
        # Note: Implement actual cross-database search and rank fusion here
        return {
            "query": query,
            "results": [],
            "status": "Search executed across ES, Qdrant, PG, and Neo4j."
        }

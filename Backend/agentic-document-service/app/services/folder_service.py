from __future__ import annotations

import json
import logging
import queue
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import httpx

from app.schemas.contracts import (
    ChatMessage,
    ChatSession,
    DocumentReference,
    ExtractCaseFieldsResponse,
    FolderChatRequest,
    FolderChatResponse,
    FolderProcessingStatusResponse,
    ProcessingState,
    PromptAuditRecord,
    PromptRecordKind,
    QueryCitation,
    QueryRequest,
    QueuedDocumentStatus,
    UploadBatchResponse,
)
from app.core.config import get_settings
from app.services.db import get_db_connection, is_db_available
from app.services.llm_chat_config import get_llm_chat_config
from app.services.legal_system_prompt import build_document_qa_system_prompt, build_legal_system_prompt, fetch_full_profile
from app.services.pipeline_service import LegalCasePipelineService, StoredCase
from app.services.secret_prompt_display import post_process_secret_prompt_response, resolve_query_and_display


logger = logging.getLogger("agentic_document_service.folder")
settings = get_settings()


@dataclass(slots=True)
class ProcessingJobRecord:
    job_id: str
    case_id: str
    folder_name: str
    user_id: str
    status: ProcessingState
    submitted_at: datetime
    updated_at: datetime
    documents: dict[str, QueuedDocumentStatus] = field(default_factory=dict)


@dataclass(slots=True)
class ChatSessionRecord:
    id: str
    case_id: str
    user_id: str
    folder_name: str
    title: str
    created_at: datetime
    updated_at: datetime
    messages: list[ChatMessage] = field(default_factory=list)


class DocumentProcessingQueue:
    """
    Persistent background worker queue for document processing jobs.

    Unlike a plain ThreadPoolExecutor, worker threads stay alive between
    submissions and pick up new jobs as soon as they arrive.  This lets
    multiple concurrent file-upload batches be processed without spinning
    up new threads on every request.
    """

    def __init__(self, num_workers: int = 4) -> None:
        self._num_workers = num_workers
        self._task_queue: queue.Queue = queue.Queue()
        self._workers: list[threading.Thread] = []
        self._shutdown_event = threading.Event()
        self._pending_count = 0
        self._count_lock = threading.Lock()
        self._start_workers()
        logger.info(
            "[DocumentProcessingQueue] started num_workers=%d",
            self._num_workers,
        )

    def _start_workers(self) -> None:
        for i in range(self._num_workers):
            t = threading.Thread(
                target=self._worker_loop,
                name=f"doc-queue-worker-{i}",
                daemon=True,
            )
            t.start()
            self._workers.append(t)

    def _worker_loop(self) -> None:
        while not self._shutdown_event.is_set():
            try:
                fn, args, kwargs = self._task_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            try:
                fn(*args, **kwargs)
            except Exception as exc:
                logger.exception("[DocumentProcessingQueue] worker error: %s", exc)
            finally:
                self._task_queue.task_done()
                with self._count_lock:
                    self._pending_count = max(0, self._pending_count - 1)

    def submit(self, fn, *args, **kwargs) -> None:
        with self._count_lock:
            self._pending_count += 1
        self._task_queue.put((fn, args, kwargs))

    def status(self) -> dict:
        return {
            "num_workers": self._num_workers,
            "queued_jobs": self._task_queue.qsize(),
            "pending_count": self._pending_count,
        }

    def shutdown(self) -> None:
        self._shutdown_event.set()


class FolderWorkflowService:
    def __init__(self, pipeline: LegalCasePipelineService) -> None:
        self._pipeline = pipeline
        self._lock = threading.RLock()
        self._jobs: dict[str, ProcessingJobRecord] = {}
        self._latest_job_by_case: dict[str, str] = {}
        self._sessions: dict[str, dict[str, ChatSessionRecord]] = {}
        self._prompt_audit: list[PromptAuditRecord] = []
        self._extracted_by_case: dict[str, dict[str, Any]] = {}
        num_workers = getattr(settings, "processing_queue_workers", 4)
        self._job_queue = DocumentProcessingQueue(num_workers=num_workers)

    def queue_documents(
        self,
        user_id: str,
        folder_name: str,
        documents: list[DocumentReference],
    ) -> UploadBatchResponse:
        case_id = folder_name
        self._ensure_case(user_id, case_id)
        now = datetime.now(tz=UTC)
        job_id = f"job-{uuid.uuid4().hex[:12]}"
        statuses: dict[str, QueuedDocumentStatus] = {}
        uploaded_files: list[QueuedDocumentStatus] = []

        db_ready_documents: list[DocumentReference] = []
        int_user_id: int | None = None
        try:
            int_user_id = int(user_id)
        except (TypeError, ValueError):
            int_user_id = None

        if is_db_available() and int_user_id is not None:
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    for document in documents:
                        db_file_id = self._create_db_file_record(
                            cur,
                            user_id=str(user_id),
                            folder_name=folder_name,
                            document=document,
                        )
                        document_metadata = dict(document.metadata)
                        if db_file_id:
                            document_metadata["db_file_id"] = db_file_id
                        document_metadata.setdefault(
                            "gcs_path",
                            self._build_file_storage_key(user_id, folder_name, document.document_name),
                        )
                        db_ready_documents.append(document.model_copy(update={"metadata": document_metadata}))
                    conn.commit()
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=queue_documents status=db_error user_id=%s folder=%s error=%s",
                    user_id,
                    folder_name,
                    exc,
                )
                db_ready_documents = list(documents)
        else:
            db_ready_documents = list(documents)

        for document in db_ready_documents:
            document_id = f"doc-{uuid.uuid4().hex[:12]}"
            status = QueuedDocumentStatus(
                document_id=document_id,
                document_name=document.document_name,
                status=ProcessingState.queued,
                processing_progress=0.0,
                current_operation="queued",
                metadata=dict(document.metadata),
                updated_at=now,
            )
            statuses[document_id] = status
            uploaded_files.append(status)

        with self._lock:
            self._jobs[job_id] = ProcessingJobRecord(
                job_id=job_id,
                case_id=case_id,
                folder_name=folder_name,
                user_id=user_id,
                status=ProcessingState.queued,
                submitted_at=now,
                updated_at=now,
                documents=statuses,
            )
            self._latest_job_by_case[case_id] = job_id

        logger.info(
            "[Agent:DocumentClassificationAgent] status=queued task=parallel_document_processing case_id=%s job_id=%s queued_documents=%s",
            case_id,
            job_id,
            len(db_ready_documents),
        )
        self._job_queue.submit(self._run_job, job_id, case_id, db_ready_documents)
        return UploadBatchResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            job_id=job_id,
            queued_count=len(db_ready_documents),
            uploadedFiles=uploaded_files,
            message="Documents queued successfully for parallel processing.",
        )

    def get_queue_status(self) -> dict:
        """Return current processing queue depth and worker count."""
        return self._job_queue.status()

    def create_folder(self, user_id: str, folder_name: str, parent_path: str = "") -> dict[str, Any]:
        # Sanitize folder name — same logic as document-service sanitizeName()
        safe_folder_name = re.sub(r"[^a-zA-Z0-9._-]", "_", folder_name.strip().strip("/"))
        clean_parent_path = parent_path.strip("/") if parent_path else ""

        # Build GCS path like document-service createFolderInternal
        folder_path_for_gcs = (
            f"{clean_parent_path}/{safe_folder_name}".strip("/")
            if clean_parent_path
            else safe_folder_name
        )
        gcs_path = f"{user_id}/documents/{folder_path_for_gcs}/"
        folder_id = str(uuid.uuid4())

        if is_db_available():
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO user_files
                            (id, user_id, originalname, gcs_path, folder_path,
                             mimetype, size, is_folder, status, processing_progress, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        [
                            folder_id,
                            user_id,
                            safe_folder_name,
                            gcs_path,
                            clean_parent_path or None,  # store parent path (not full path) — matches document-service
                            "folder/x-directory",
                            0,
                            True,
                            "processed",
                            100,
                        ],
                    )
                    conn.commit()
                logger.info(
                    "[FolderService] task=create_folder status=saved user_id=%s folder=%s id=%s",
                    user_id,
                    safe_folder_name,
                    folder_id,
                )
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=create_folder status=db_error user_id=%s folder=%s error=%s",
                    user_id,
                    safe_folder_name,
                    exc,
                )

        # Also ensure in-memory entry for current session
        self._ensure_case(user_id, folder_name)

        return {
            "success": True,
            "folder": {
                "id": folder_id,
                "name": safe_folder_name,
                "originalname": safe_folder_name,
                "path": folder_path_for_gcs,
                "case_title": folder_name,
                "gcs_path": gcs_path,
                "created_at": datetime.now(tz=UTC).isoformat(),
                "document_count": 0,
            },
        }

    def _truncate_case_value(self, value: Any, limit: int = 100) -> str | None:
        if value is None:
            return None
        text = str(value)
        return text[:limit] if len(text) > limit else text

    @staticmethod
    def _normalize_date(value: Any) -> str | None:
        """
        Normalize any date string to YYYY-MM-DD for PostgreSQL.

        Handles:
          YYYY-MM-DD  → returned as-is
          DD/MM/YYYY  → converted  (Indian / European format)
          DD-MM-YYYY  → converted
          MM/DD/YYYY  → converted when day part > 12 (unambiguous)
          ISO 8601 with time component → date part extracted
          None / empty / unparseable  → None
        """
        if not value:
            return None
        raw = str(value).strip()
        if not raw:
            return None

        # Already ISO format YYYY-MM-DD (possibly with time)
        if len(raw) >= 10 and raw[4] == "-":
            return raw[:10]  # truncate time component if present

        # Try DD/MM/YYYY or DD-MM-YYYY
        for sep in ("/", "-"):
            if sep in raw:
                parts = raw.split(sep)
                if len(parts) == 3:
                    a, b, c = parts[0].strip(), parts[1].strip(), parts[2].strip()
                    # Detect YYYY at position 0 (YYYY/MM/DD)
                    if len(a) == 4 and a.isdigit():
                        return f"{a}-{b.zfill(2)}-{c.zfill(2)}"
                    # Detect YYYY at position 2 (DD/MM/YYYY or MM/DD/YYYY)
                    if len(c) == 4 and c.isdigit():
                        day_or_month = int(a) if a.isdigit() else 0
                        # If first part > 12 it must be the day (DD/MM/YYYY)
                        # For Indian dates always treat as DD/MM/YYYY
                        return f"{c}-{b.zfill(2)}-{a.zfill(2)}"

        # Last resort: let Python's datetime parse it
        try:
            from datetime import datetime as _dt
            return _dt.strptime(raw, "%d %b %Y").strftime("%Y-%m-%d")
        except Exception:
            pass

        logger.warning("[FolderService] Could not normalize date value=%r — storing NULL", raw)
        return None

    def _get_table_columns(self, cur: Any, table_name: str) -> set[str]:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s
            """,
            [table_name],
        )
        return {row["column_name"] for row in cur.fetchall()}

    def _build_case_db_payload(self, case_data: dict[str, Any], *, default_status: str = "Active") -> dict[str, Any]:
        nd = self._normalize_date
        return {
            "case_title": self._truncate_case_value(case_data.get("case_title") or "Untitled Case", 255),
            "case_number": self._truncate_case_value(case_data.get("case_number"), 255),
            "filing_date": nd(case_data.get("filing_date")),
            "case_type": self._truncate_case_value(case_data.get("case_type") or "", 100),
            "sub_type": self._truncate_case_value(case_data.get("sub_type"), 100),
            "court_name": self._truncate_case_value(case_data.get("court_name") or "", 255),
            "court_level": self._truncate_case_value(case_data.get("court_level"), 100),
            "bench_division": self._truncate_case_value(case_data.get("bench_division"), 100),
            "jurisdiction": self._truncate_case_value(case_data.get("jurisdiction"), 100),
            "state": self._truncate_case_value(case_data.get("state"), 100),
            "judges": json.dumps(case_data["judges"]) if case_data.get("judges") else None,
            "court_room_no": self._truncate_case_value(case_data.get("court_room_no"), 50),
            "petitioners": json.dumps(case_data["petitioners"]) if case_data.get("petitioners") else None,
            "respondents": json.dumps(case_data["respondents"]) if case_data.get("respondents") else None,
            "category_type": self._truncate_case_value(case_data.get("category_type"), 100),
            "primary_category": self._truncate_case_value(case_data.get("primary_category"), 100),
            "sub_category": self._truncate_case_value(case_data.get("sub_category"), 100),
            "complexity": self._truncate_case_value(case_data.get("complexity"), 50),
            "monetary_value": case_data.get("monetary_value"),
            "priority_level": self._truncate_case_value(case_data.get("priority_level"), 50),
            "status": self._truncate_case_value(case_data.get("status") or default_status, 50),
            "case_prefix": self._truncate_case_value(case_data.get("case_prefix"), 100),
            "case_year": int(case_data["case_year"]) if case_data.get("case_year") else None,
            "case_nature": self._truncate_case_value(case_data.get("case_nature"), 100),
            "next_hearing_date": nd(case_data.get("next_hearing_date")),
            "document_type": self._truncate_case_value(case_data.get("document_type"), 100),
            "filed_by": self._truncate_case_value(case_data.get("filed_by"), 100),
        }

    def _migrate_temp_files_to_case_folder(
        self,
        cur: Any,
        *,
        user_id: str,
        temp_folder_name: str | None,
        target_folder_path: str,
        target_gcs_prefix: str,
    ) -> int:
        temp_name = (temp_folder_name or "").strip().strip("/")
        if not temp_name:
            return 0

        legacy_temp_gcs_prefix = f"{user_id}/documents/{temp_name}/"
        cur.execute(
            """
            UPDATE user_files
            SET
                folder_path = CASE
                    WHEN folder_path = %s THEN %s
                    WHEN folder_path LIKE %s THEN %s || substring(folder_path FROM %s)
                    ELSE folder_path
                END,
                gcs_path = CASE
                    WHEN gcs_path LIKE %s THEN %s || substring(gcs_path FROM %s)
                    ELSE gcs_path
                END,
                updated_at = NOW()
            WHERE user_id::text = %s
              AND is_folder = false
              AND (
                  folder_path = %s
                  OR folder_path LIKE %s
                  OR gcs_path LIKE %s
              )
            """,
            [
                temp_name,
                target_folder_path,
                f"{temp_name}/%",
                target_folder_path,
                len(temp_name) + 1,
                f"{legacy_temp_gcs_prefix}%",
                target_gcs_prefix,
                len(legacy_temp_gcs_prefix) + 1,
                user_id,
                temp_name,
                f"{temp_name}/%",
                f"{legacy_temp_gcs_prefix}%",
            ],
        )
        return cur.rowcount or 0

    def _build_file_storage_key(self, user_id: str, folder_name: str, document_name: str) -> str:
        safe_file_name = document_name.replace("\\", "_").replace("/", "_")
        clean_folder_name = (folder_name or "").strip().strip("/")
        return f"{user_id}/documents/{clean_folder_name}/{safe_file_name}"

    def _build_text_summary(self, text: str | None, limit: int = 500) -> str | None:
        if not text:
            return None
        clean = " ".join(str(text).split())
        if len(clean) <= limit:
            return clean
        return clean[: limit - 3].rstrip() + "..."

    def _create_db_file_record(
        self,
        cur: Any,
        *,
        user_id: str,
        folder_name: str,
        document: DocumentReference,
    ) -> str | None:
        file_columns = self._get_table_columns(cur, "user_files")
        if not file_columns:
            return None

        file_id = str(uuid.uuid4())
        insert_payload: dict[str, Any] = {
            "id": file_id,
            "user_id": user_id,
            "originalname": document.document_name,
            "gcs_path": self._build_file_storage_key(str(user_id), folder_name, document.document_name),
            "folder_path": (folder_name or "").strip().strip("/") or None,
            "mimetype": document.mime_type or "application/octet-stream",
            "size": int(document.metadata.get("size") or 0),
            "is_folder": False,
            "status": "queued",
            "processing_progress": 0,
        }
        insert_columns = [column for column in insert_payload.keys() if column in file_columns]
        if "created_at" in file_columns:
            insert_columns.append("created_at")
        placeholders = ["NOW()" if column == "created_at" else "%s" for column in insert_columns]
        values = [insert_payload[column] for column in insert_columns if column != "created_at"]
        cur.execute(
            f"""
            INSERT INTO user_files ({", ".join(insert_columns)})
            VALUES ({", ".join(placeholders)})
            """,
            values,
        )
        return file_id

    def _update_db_file_processing_state(
        self,
        *,
        file_id: str | None,
        status: str,
        processing_progress: float,
        stored_document_uri: str | None = None,
        extracted_text: str | None = None,
        summary: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if not file_id or not is_db_available():
            return

        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                file_columns = self._get_table_columns(cur, "user_files")
                update_payload: dict[str, Any] = {
                    "status": status,
                    "processing_progress": processing_progress,
                }
                if stored_document_uri and "gcs_path" in file_columns:
                    update_payload["gcs_path"] = stored_document_uri
                if extracted_text is not None and "full_text_content" in file_columns:
                    update_payload["full_text_content"] = extracted_text
                if summary is not None and "summary" in file_columns:
                    update_payload["summary"] = summary
                if metadata is not None and "metadata" in file_columns:
                    update_payload["metadata"] = json.dumps(metadata)
                if "updated_at" in file_columns:
                    update_payload["updated_at"] = "__NOW__"

                assignments: list[str] = []
                params: list[Any] = []
                for column, value in update_payload.items():
                    if column not in file_columns:
                        continue
                    if value == "__NOW__":
                        assignments.append(f"{column} = NOW()")
                    else:
                        assignments.append(f"{column} = %s")
                        params.append(value)
                if not assignments:
                    return
                params.append(file_id)
                cur.execute(f"UPDATE user_files SET {', '.join(assignments)} WHERE id = %s", params)
                conn.commit()
        except Exception as exc:
            logger.warning(
                "[FolderService] task=update_db_file_processing_state status=warning file_id=%s error=%s",
                file_id,
                exc,
            )

    def create_case(self, user_id: str, case_data: dict[str, Any]) -> dict[str, Any]:
        """Create a case record + linked user_files folder using document-service-compatible storage."""
        int_user_id: int | None = None
        try:
            int_user_id = int(user_id)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid user_id: {user_id}")

        case_payload = self._build_case_db_payload(case_data)
        case_title = case_payload["case_title"]

        if not is_db_available():
            folder_result = self.create_folder(user_id, case_title or "Untitled Case")
            case_id = str(uuid.uuid4())
            self._ensure_case(user_id, case_id)
            return {
                "message": "Case created successfully with folder",
                "case": {"id": case_id, "case_title": case_title, "user_id": user_id},
                "folder": folder_result.get("folder", {}),
            }

        with get_db_connection() as conn, conn.cursor() as cur:
            case_columns = self._get_table_columns(cur, "cases")
            insert_payload = {"user_id": int_user_id}
            insert_payload.update({key: value for key, value in case_payload.items() if key in case_columns})
            insert_columns = list(insert_payload.keys())
            placeholders = ", ".join(["%s"] * len(insert_columns))
            cur.execute(
                f"""
                INSERT INTO cases ({", ".join(insert_columns)})
                VALUES ({placeholders})
                RETURNING *
                """,
                [insert_payload[column] for column in insert_columns],
            )
            new_case = cur.fetchone()
            case_id = str(new_case["id"])

            safe_case_name = re.sub(r"[^a-zA-Z0-9._-]", "_", (case_title or "Untitled_Case").strip())
            parent_path = f"{user_id}/cases"
            folder_path_for_gcs = f"{parent_path}/{safe_case_name}"
            gcs_path = f"{user_id}/documents/{folder_path_for_gcs}/"
            folder_id = str(uuid.uuid4())
            cur.execute(
                """
                INSERT INTO user_files
                    (id, user_id, originalname, gcs_path, folder_path,
                     mimetype, size, is_folder, status, processing_progress, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                """,
                [
                    folder_id, int_user_id, safe_case_name, gcs_path, parent_path,
                    "folder/x-directory", 0, True, "processed", 100,
                ],
            )

            cur.execute(
                "UPDATE cases SET folder_id = %s WHERE id = %s RETURNING *",
                [folder_id, case_id],
            )
            updated_case = cur.fetchone()

            migrated_count = self._migrate_temp_files_to_case_folder(
                cur,
                user_id=str(user_id),
                temp_folder_name=case_data.get("temp_folder_name"),
                target_folder_path=folder_path_for_gcs,
                target_gcs_prefix=gcs_path,
            )
            conn.commit()

        folder_dict = {
            "id": folder_id,
            "name": safe_case_name,
            "originalname": safe_case_name,
            "folder_path": parent_path,
            "gcs_path": gcs_path,
            "created_at": datetime.now(tz=UTC).isoformat(),
        }
        logger.info(
            "[FolderService] task=create_case status=created user_id=%s case_id=%s folder_id=%s migrated_files=%s",
            user_id, case_id, folder_id, migrated_count,
        )
        return {
            "message": "Case created successfully with folder",
            "case": self._get_case_from_db(case_id, user_id) or self._serialize_case_row(updated_case),
            "folder": folder_dict,
            "migrated_files": migrated_count,
        }

    def update_case(self, case_id: str, user_id: str, case_data: dict[str, Any]) -> dict[str, Any]:
        if not is_db_available():
            raise ValueError("Case updates require database connectivity.")

        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            raise ValueError(f"Case '{case_id}' not found.")

        case_payload = self._build_case_db_payload(case_data, default_status=case_data.get("status") or "Active")
        with get_db_connection() as conn, conn.cursor() as cur:
            case_columns = self._get_table_columns(cur, "cases")
            update_columns = [
                column for column, value in case_payload.items()
                if column in case_columns and value is not None
            ]
            if not update_columns:
                existing_case = self._get_case_from_db(case_id, user_id)
                if not existing_case:
                    raise ValueError(f"Case '{case_id}' not found.")
                return existing_case

            assignments = ", ".join(f"{column} = %s" for column in update_columns)
            values = [case_payload[column] for column in update_columns]
            if "updated_at" in case_columns:
                assignments = f"{assignments}, updated_at = NOW()"
            values.extend([case_id, text_user_ids])
            cur.execute(
                f"""
                UPDATE cases
                SET {assignments}
                WHERE id::text = %s
                  AND user_id::text = ANY(%s::text[])
                RETURNING *
                """,
                values,
            )
            updated_case = cur.fetchone()
            conn.commit()

        if not updated_case:
            raise ValueError(f"Case '{case_id}' not found.")
        return self._get_case_from_db(case_id, user_id) or self._serialize_case_row(updated_case)

    def list_folders(self, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            db_folders = self._list_folders_from_db(user_id)
            logger.info(
                "[FolderService] task=list_folders source=db user_id=%s folder_count=%s",
                user_id,
                len(db_folders),
            )
            if db_folders:
                return {"folders": db_folders}
            # Fallback: if user_files folders are missing, derive folder cards from cases table.
            case_folders = self._list_folders_from_cases_db(user_id)
            logger.info(
                "[FolderService] task=list_folders source=db-cases-fallback user_id=%s folder_count=%s",
                user_id,
                len(case_folders),
            )
            if case_folders:
                return {"folders": case_folders}
        folders: list[dict[str, Any]] = []
        for case_id, stored_case in self._pipeline._cases.items():
            folders.append(
                {
                    "id": case_id,
                    "name": case_id,
                    "case_title": stored_case.form_data.get("case_title") or case_id,
                    "folder_path": "",
                    "created_at": stored_case.created_at.isoformat(),
                    "children": [],
                }
            )
        folders.sort(key=lambda item: item["created_at"], reverse=True)
        logger.info(
            "[FolderService] task=list_folders source=memory user_id=%s folder_count=%s",
            user_id,
            len(folders),
        )
        return {"folders": folders}

    def list_cases(self, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            db_cases = self._list_cases_from_db(user_id)
            return {
                "message": "Cases fetched successfully.",
                "cases": db_cases,
                "totalCases": len(db_cases),
            }
        cases: list[dict[str, Any]] = []
        for case_id, stored_case in self._pipeline._cases.items():
            extracted = self._extracted_by_case.get(case_id, {})
            case_title = extracted.get("caseTitle") or stored_case.form_data.get("case_title") or case_id
            cases.append(
                {
                    "id": case_id,
                    "folder_id": case_id,
                    "case_title": case_title,
                    "case_number": extracted.get("caseNumber") or stored_case.form_data.get("case_number"),
                    "case_type": extracted.get("caseType") or stored_case.form_data.get("case_type"),
                    "court_name": extracted.get("courtName") or stored_case.form_data.get("court_details"),
                    "jurisdiction": extracted.get("jurisdiction"),
                    "petitioners": [{"fullName": item} for item in extracted.get("petitioners", [])],
                    "respondents": [{"fullName": item} for item in extracted.get("respondents", [])],
                    "status": self._get_case_status(case_id),
                    "created_at": stored_case.created_at.isoformat(),
                }
            )
        cases.sort(key=lambda item: item["created_at"], reverse=True)
        return {
            "message": "Cases fetched successfully.",
            "cases": cases,
            "totalCases": len(cases),
        }

    def get_case(self, case_id: str, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            db_case = self._get_case_from_db(case_id, user_id)
            if db_case:
                return db_case
        stored_case = self._pipeline._cases.get(case_id)
        if not stored_case:
            raise ValueError(f"Case '{case_id}' not found.")
        extracted = self._extracted_by_case.get(case_id, {})
        return {
            "id": case_id,
            "folder_id": case_id,
            "case_title": extracted.get("caseTitle") or stored_case.form_data.get("case_title") or case_id,
            "case_number": extracted.get("caseNumber") or stored_case.form_data.get("case_number"),
            "case_type": extracted.get("caseType") or stored_case.form_data.get("case_type"),
            "court_name": extracted.get("courtName") or stored_case.form_data.get("court_details"),
            "jurisdiction": extracted.get("jurisdiction"),
            "petitioners": [{"fullName": item} for item in extracted.get("petitioners", [])],
            "respondents": [{"fullName": item} for item in extracted.get("respondents", [])],
            "status": self._get_case_status(case_id),
            "documents": [
                {
                    "document_id": document.document_id,
                    "document_name": document.document_name,
                    "doc_type": document.doc_type.value,
                    "stored_document_uri": document.stored_document_uri,
                }
                for document in stored_case.documents
            ],
            "created_at": stored_case.created_at.isoformat(),
        }

    def delete_case(self, case_id: str, user_id: str | None = None) -> dict[str, Any]:
        db_deleted = False
        db_counts: dict[str, int] = {}
        resolved_folder_name = case_id

        if is_db_available():
            accessible_user_ids = self._get_accessible_user_ids(user_id) if user_id else []
            text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    case_row = None
                    if text_user_ids:
                        cur.execute(
                            """
                            SELECT c.id, c.folder_id, uf.originalname AS folder_name, uf.folder_path, uf.gcs_path
                            FROM cases c
                            LEFT JOIN user_files uf ON uf.id = c.folder_id
                            WHERE c.id::text = %s AND c.user_id::text = ANY(%s::text[])
                            LIMIT 1
                            """,
                            [str(case_id), text_user_ids],
                        )
                    else:
                        cur.execute(
                            """
                            SELECT c.id, c.folder_id, uf.originalname AS folder_name, uf.folder_path, uf.gcs_path
                            FROM cases c
                            LEFT JOIN user_files uf ON uf.id = c.folder_id
                            WHERE c.id::text = %s
                            LIMIT 1
                            """,
                            [str(case_id)],
                        )
                    case_row = cur.fetchone()

                    folder_row = None
                    if case_row and case_row.get("folder_id"):
                        folder_row = {
                            "id": str(case_row.get("folder_id")),
                            "originalname": case_row.get("folder_name"),
                            "folder_path": case_row.get("folder_path") or "",
                            "gcs_path": case_row.get("gcs_path"),
                        }
                    else:
                        if text_user_ids:
                            cur.execute(
                                """
                                SELECT id, originalname, folder_path, gcs_path
                                FROM user_files
                                WHERE is_folder = true
                                  AND originalname = %s
                                  AND user_id::text = ANY(%s::text[])
                                ORDER BY created_at DESC
                                LIMIT 1
                                """,
                                [str(case_id), text_user_ids],
                            )
                        else:
                            cur.execute(
                                """
                                SELECT id, originalname, folder_path, gcs_path
                                FROM user_files
                                WHERE is_folder = true
                                  AND originalname = %s
                                ORDER BY created_at DESC
                                LIMIT 1
                                """,
                                [str(case_id)],
                            )
                        folder_row = cur.fetchone()
                        if folder_row:
                            if text_user_ids:
                                cur.execute(
                                    "SELECT id FROM cases WHERE folder_id::text = %s AND user_id::text = ANY(%s::text[]) LIMIT 1",
                                    [str(folder_row.get("id")), text_user_ids],
                                )
                            else:
                                cur.execute(
                                    "SELECT id FROM cases WHERE folder_id::text = %s LIMIT 1",
                                    [str(folder_row.get("id"))],
                                )
                            linked_case = cur.fetchone()
                            if linked_case:
                                case_row = {"id": linked_case.get("id"), "folder_id": folder_row.get("id")}

                    if not folder_row and not case_row:
                        raise ValueError(f"Case or folder '{case_id}' not found.")

                    folder_name = str((folder_row or {}).get("originalname") or case_id)
                    resolved_folder_name = folder_name
                    stored_path = str((folder_row or {}).get("folder_path") or "")
                    if folder_name and stored_path and not stored_path.endswith(folder_name):
                        full_folder_path = f"{stored_path}/{folder_name}".strip("/")
                    else:
                        full_folder_path = (stored_path or folder_name).strip("/")
                    gcs_prefix = (folder_row or {}).get("gcs_path")

                    file_query = """
                        SELECT id
                        FROM user_files
                        WHERE is_folder = false
                    """
                    file_params: list[Any] = []
                    path_conditions = [
                        "folder_path = %s",
                        "folder_path LIKE %s",
                    ]
                    file_params.extend([full_folder_path, f"{full_folder_path}/%"])
                    if gcs_prefix:
                        path_conditions.append("gcs_path LIKE %s")
                        file_params.append(f"{gcs_prefix}%")
                    file_query += f" AND ({' OR '.join(path_conditions)})"
                    if text_user_ids:
                        file_query += " AND user_id::text = ANY(%s::text[])"
                        file_params.append(text_user_ids)
                    cur.execute(file_query, file_params)
                    file_ids = [str(row["id"]) for row in cur.fetchall()]

                    if file_ids:
                        cur.execute("DELETE FROM chunk_vectors WHERE file_id::text = ANY(%s::text[])", [file_ids])
                        db_counts["chunk_vectors"] = cur.rowcount or 0
                        cur.execute("DELETE FROM file_chunks WHERE file_id::text = ANY(%s::text[])", [file_ids])
                        db_counts["file_chunks"] = cur.rowcount or 0
                        cur.execute("DELETE FROM user_files WHERE id::text = ANY(%s::text[])", [file_ids])
                        db_counts["files"] = cur.rowcount or 0
                    else:
                        db_counts["chunk_vectors"] = 0
                        db_counts["file_chunks"] = 0
                        db_counts["files"] = 0

                    cur.execute("DELETE FROM folder_chats WHERE folder_name = %s", [folder_name])
                    db_counts["folder_chats"] = cur.rowcount or 0

                    if folder_row and folder_row.get("id"):
                        cur.execute("DELETE FROM user_files WHERE id::text = %s", [str(folder_row.get("id"))])
                        db_counts["folder"] = cur.rowcount or 0
                    else:
                        db_counts["folder"] = 0

                    if case_row and case_row.get("id"):
                        cur.execute("DELETE FROM cases WHERE id::text = %s", [str(case_row.get("id"))])
                        db_counts["cases"] = cur.rowcount or 0
                    else:
                        db_counts["cases"] = 0

                    conn.commit()
                    db_deleted = any(value > 0 for value in db_counts.values())
            except Exception as exc:
                logger.exception("[FolderService] task=delete_case status=db_error case_id=%s error=%s", case_id, exc)
                raise

        with self._lock:
            existed = self._pipeline._cases.pop(case_id, None)
            self._pipeline._cases.pop(resolved_folder_name, None)
            self._extracted_by_case.pop(case_id, None)
            self._extracted_by_case.pop(resolved_folder_name, None)
            self._sessions.pop(case_id, None)
            self._sessions.pop(resolved_folder_name, None)

        return {
            "success": True,
            "deleted": bool(existed) or db_deleted,
            "deleted_counts": db_counts,
            "folder_name": resolved_folder_name,
        }

    def get_processing_status(self, folder_name: str) -> FolderProcessingStatusResponse:
        case_id = folder_name
        with self._lock:
            job_id = self._latest_job_by_case.get(case_id)
            job = self._jobs.get(job_id) if job_id else None
        if not job:
            raise ValueError(f"No processing job found for folder '{folder_name}'.")

        documents = sorted(job.documents.values(), key=lambda item: item.document_name.lower())
        total = len(documents)
        processed = sum(1 for item in documents if item.status == ProcessingState.processed)
        failed = sum(1 for item in documents if item.status == ProcessingState.error)
        progress = round(sum(item.processing_progress for item in documents) / total, 2) if total else 0.0
        return FolderProcessingStatusResponse(
            folderName=folder_name,
            case_id=case_id,
            job_id=job.job_id,
            status=job.status,
            progress=progress,
            total_documents=total,
            processed_documents=processed,
            failed_documents=failed,
            documents=documents,
            updated_at=job.updated_at,
        )

    def extract_case_fields(self, folder_name: str) -> ExtractCaseFieldsResponse:
        from app.services.adapters.document_ai import _call_gemini_for_extraction
        case_id = folder_name
        stored_case = self._pipeline._cases.get(case_id)
        if not stored_case:
            raise ValueError(f"Case '{case_id}' does not exist.")
        extracted = dict(self._extracted_by_case.get(case_id, {}))

        # If extraction is thin (< 3 meaningful fields), re-run Gemini on combined document text
        meaningful_fields = {"caseTitle", "caseNumber", "caseType", "courtName", "jurisdiction",
                             "filingDate", "petitioners", "respondents"}
        has_rich_data = len([k for k in extracted if k in meaningful_fields and extracted[k]]) >= 2

        if not has_rich_data and stored_case.documents:
            combined_text = "\n\n---\n\n".join(
                f"[Document: {doc.document_name}]\n{doc.text}"
                for doc in stored_case.documents
                if doc.text and len(doc.text) > 50
            )
            if combined_text:
                logger.info(
                    "[FolderService] task=extract_case_fields re-running Gemini extraction case_id=%s text_chars=%s",
                    case_id, len(combined_text),
                )
                gemini_data = _call_gemini_for_extraction(combined_text)
                if gemini_data:
                    normalized = self._normalize_entities(gemini_data)
                    for key, value in normalized.items():
                        if value and not extracted.get(key):
                            extracted[key] = value
                    self._extracted_by_case[case_id] = extracted

        return ExtractCaseFieldsResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            extractedData=extracted,
            requiresReview=not bool(extracted.get("caseNumber") or extracted.get("caseType")),
            sourceDocuments=[document.document_name for document in stored_case.documents],
            message="Extracted case fields generated from processed folder documents.",
        )

    def get_documents_in_folder(self, folder_name: str, user_id: str | None = None) -> dict[str, Any]:
        if is_db_available():
            documents = self._get_documents_in_folder_from_db(folder_name, user_id)
            if documents is not None:
                return {
                    "message": f"Documents in folder '{folder_name}' fetched successfully.",
                    "folderName": folder_name,
                    "files": documents,
                    "documents": documents,
                    "totalDocuments": len(documents),
                }

        stored_case = self._pipeline._cases.get(folder_name)
        if not stored_case:
            return {
                "message": f"Documents in folder '{folder_name}' fetched successfully.",
                "folderName": folder_name,
                "documents": [],
                "totalDocuments": 0,
            }
        documents = [
            {
                "id": document.document_id,
                "name": document.document_name,
                "originalname": document.document_name,
                "mimetype": "application/octet-stream",
                "size": 0,
                "created_at": stored_case.created_at.isoformat(),
                "status": "processed",
                "processing_progress": 100.0,
                "folder_path": folder_name,
            }
            for document in stored_case.documents
        ]
        return {
            "message": f"Documents in folder '{folder_name}' fetched successfully.",
            "folderName": folder_name,
            "files": documents,
            "documents": documents,
            "totalDocuments": len(documents),
        }

    def answer_folder_chat(
        self,
        user_id: str,
        folder_name: str,
        request: FolderChatRequest,
        authorization: str | None = None,
    ) -> FolderChatResponse:
        case_id = folder_name
        secret_id = (request.secret_id or "").strip() or None
        query_text, display_question = resolve_query_and_display(
            question=request.question,
            secret_id=secret_id,
            prompt_label=request.prompt_label,
            authorization=authorization,
        )
        if not query_text:
            raise ValueError("question is required")
        llm_config = get_llm_chat_config(user_id=user_id, force_refresh=False)
        user_profile = fetch_full_profile(user_id, authorization)
        system_instruction = build_document_qa_system_prompt(user_profile)
        logger.info(
            "[FolderService] task=answer_folder_chat system_prompt_chars=%s user_id=%s folder=%s",
            len(system_instruction),
            user_id,
            folder_name,
        )
        effective_query_text = self._build_query_with_recent_history(
            user_id=user_id,
            folder_name=folder_name,
            session_id=request.session_id,
            query_text=query_text,
            max_history=int(llm_config.get("max_conversation_history") or 0),
        )
        self._record_prompt(
            case_id=case_id,
            user_id=user_id,
            kind=PromptRecordKind.user_query,
            prompt_text=None if secret_id else query_text,
            metadata={
                "session_id": request.session_id or "",
                "prompt_label": display_question if secret_id else (request.prompt_label or ""),
                "secret_id": secret_id or "",
            },
            secret_prompt=bool(secret_id),
        )
        file_ids: list[str] = []
        try:
            db_docs = self.get_documents_in_folder(folder_name, user_id)
            records = db_docs.get("documents") or db_docs.get("files") or []
            file_ids = [str(item.get("id")) for item in records if item.get("id")]
        except Exception as exc:
            logger.warning("[FolderService] task=answer_folder_chat status=file_list_fallback folder=%s error=%s", folder_name, exc)
        query_response = self._pipeline.answer_query_for_files(
            QueryRequest(user_id=user_id, case_id=case_id, query=query_text),
            file_ids,
            system_instruction=system_instruction,
        )
        if secret_id:
            # Secret/preset prompts are expected to produce machine-readable JSON.
            # Wrap/normalize the output so the frontend renderer can parse reliably.
            query_response.answer = post_process_secret_prompt_response(query_response.answer)
        session = self._get_or_create_session(user_id, folder_name, request.session_id, display_question)
        self._append_message(session, "user", display_question)
        self._append_message(session, "assistant", query_response.answer)
        citations = [citation for segment in query_response.answer_segments for citation in segment.citations]
        self._save_folder_chat_to_db(
            user_id=user_id,
            folder_name=folder_name,
            question=display_question,
            answer=query_response.answer,
            session_id=session.id,
            citations=citations,
            used_secret_prompt=bool(secret_id),
            prompt_label=display_question if secret_id else None,
            secret_id=secret_id,
        )
        return FolderChatResponse(
            success=True,
            folderName=folder_name,
            case_id=case_id,
            session_id=session.id,
            answer=query_response.answer,
            citations=citations,
            answer_segments=query_response.answer_segments,
            stored_chat_count=len(session.messages),
            prompt_stored=True,
            generated_at=query_response.generated_at,
        )

    def _build_query_with_recent_history(
        self,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        query_text: str,
        max_history: int,
    ) -> str:
        history_limit = max(0, int(max_history or 0))
        if history_limit <= 0:
            return query_text
        history = self._get_recent_chat_history(
            user_id=user_id,
            folder_name=folder_name,
            session_id=session_id,
            max_history=history_limit,
        )
        if not history:
            return query_text
        history_lines: list[str] = []
        for item in history:
            question = str(item.get("question") or "").strip()
            answer = str(item.get("answer") or "").strip()
            if question:
                history_lines.append(f"User: {question}")
            if answer:
                history_lines.append(f"Assistant: {answer}")
        if not history_lines:
            return query_text
        return (
            "Use the prior conversation only as supporting context. If the latest question narrows or changes the issue, "
            "prioritize the latest question.\n\n"
            f"Conversation history:\n{chr(10).join(history_lines)}\n\n"
            f"Current question:\n{query_text}"
        )

    def _get_recent_chat_history(
        self,
        *,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        max_history: int,
    ) -> list[dict[str, Any]]:
        if max_history <= 0:
            return []
        history: list[dict[str, Any]] = []
        if is_db_available() and session_id:
            try:
                with get_db_connection() as conn, conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT question, answer, created_at
                        FROM folder_chats
                        WHERE folder_name = %s
                          AND user_id::text = %s
                          AND session_id::text = %s
                        ORDER BY created_at DESC
                        LIMIT %s
                        """,
                        [folder_name, str(user_id), str(session_id), max_history],
                    )
                    rows = list(cur.fetchall())
                history = [{"question": row.get("question"), "answer": row.get("answer")} for row in reversed(rows)]
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=recent_chat_history status=db_fallback folder=%s session_id=%s error=%s",
                    folder_name,
                    session_id,
                    exc,
                )
        if history:
            return history
        with self._lock:
            session = self._sessions.get(folder_name, {}).get(session_id or "")
            if not session:
                return []
            pairs: list[dict[str, Any]] = []
            current_question: str | None = None
            for message in session.messages[-(max_history * 2) :]:
                if message.role == "user":
                    current_question = message.content
                elif message.role == "assistant":
                    pairs.append({"question": current_question or "", "answer": message.content})
                    current_question = None
            return pairs[-max_history:]

    def list_sessions(self, folder_name: str) -> list[ChatSession]:
        sessions = self._sessions.get(folder_name, {})
        ordered = sorted(sessions.values(), key=lambda item: item.updated_at, reverse=True)
        return [self._to_session_model(item) for item in ordered]

    def get_session(self, folder_name: str, session_id: str) -> ChatSession:
        session = self._sessions.get(folder_name, {}).get(session_id)
        if not session:
            raise ValueError(f"Session '{session_id}' was not found for folder '{folder_name}'.")
        return self._to_session_model(session)

    def delete_session(self, folder_name: str, session_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(folder_name, {}).pop(session_id, None)
        if not session:
            raise ValueError(f"Session '{session_id}' was not found for folder '{folder_name}'.")
        return {"success": True, "deleted": session_id}

    def delete_all_sessions(self, folder_name: str) -> dict[str, Any]:
        with self._lock:
            deleted_count = len(self._sessions.get(folder_name, {}))
            self._sessions[folder_name] = {}
        return {"success": True, "deleted_count": deleted_count}

    def list_prompt_audit(self, case_id: str) -> list[PromptAuditRecord]:
        return [record for record in self._prompt_audit if record.case_id == case_id]

    def record_secret_preset_use(self, user_id: str, case_id: str, preset_id: str, preset_name: str) -> None:
        self._record_prompt(
            case_id=case_id,
            user_id=user_id,
            kind=PromptRecordKind.preset_execution,
            prompt_text=None,
            metadata={"preset_id": preset_id, "preset_name": preset_name},
            secret_prompt=True,
        )

    def _run_job(self, job_id: str, case_id: str, documents: list[DocumentReference]) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.status = ProcessingState.processing
            job.updated_at = datetime.now(tz=UTC)
            document_ids = list(job.documents.keys())

        stored_case = self._pipeline._cases[case_id]
        max_workers = max(1, min(self._pipeline._settings.max_parallel_document_workers, len(documents) or 1))
        with ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="doc-worker") as executor:
            future_map = {}
            for document, document_id in zip(documents, document_ids, strict=False):
                db_file_id = document.metadata.get("db_file_id") if isinstance(document.metadata, dict) else None
                self._update_db_file_processing_state(
                    file_id=db_file_id,
                    status=ProcessingState.processing.value,
                    processing_progress=20.0,
                )
                self._update_document(job_id, document_id, ProcessingState.processing, 20.0, "ocr_and_validation")
                future_map[executor.submit(self._pipeline._process_single_document, case_id, document)] = {
                    "document_id": document_id,
                    "source_document": document,
                }

            for future in as_completed(future_map):
                future_context = future_map[future]
                document_id = future_context["document_id"]
                source_document = future_context["source_document"]
                db_file_id = source_document.metadata.get("db_file_id") if isinstance(source_document.metadata, dict) else None
                try:
                    bundle = future.result()
                    self._update_db_file_processing_state(
                        file_id=db_file_id,
                        status=ProcessingState.embedding_pending.value,
                        processing_progress=80.0,
                    )
                    self._update_document(job_id, document_id, ProcessingState.embedding_pending, 80.0, "vector_indexing")
                    persisted_chunks = self._pipeline.persist_chunks_to_db(db_file_id, bundle.chunks)
                    self._pipeline._vector_store.upsert_chunks(case_id, persisted_chunks)
                    logger.info(
                        "[Upload] Step 4/4: Storing — in-memory vector index updated case_id=%s document=%s chunks=%d",
                        case_id,
                        source_document.document_name,
                        len(persisted_chunks),
                    )
                    stored_case.documents.append(bundle.stored_document)
                    self._merge_extracted_case_data(case_id, bundle.process_result.metadata, bundle.stored_document.text)
                    self._update_db_file_processing_state(
                        file_id=db_file_id,
                        status=ProcessingState.processed.value,
                        processing_progress=100.0,
                        stored_document_uri=bundle.process_result.stored_document_uri,
                        extracted_text=bundle.stored_document.text,
                        summary=self._build_text_summary(bundle.stored_document.text),
                        metadata={
                            **bundle.process_result.metadata,
                            "doc_type": bundle.process_result.doc_type.value,
                            "chunk_count": bundle.process_result.chunk_count,
                            "quality_score": bundle.process_result.quality_score,
                        },
                    )
                    self._update_document(
                        job_id,
                        document_id,
                        ProcessingState.processed,
                        100.0,
                        "completed",
                        doc_type=bundle.process_result.doc_type,
                        stored_document_uri=bundle.process_result.stored_document_uri,
                        chunk_count=bundle.process_result.chunk_count,
                        quality_score=bundle.process_result.quality_score,
                        metadata=bundle.process_result.metadata,
                    )
                except Exception as exc:
                    logger.exception(
                        "[Agent:DocumentClassificationAgent] status=fail task=parallel_document_processing case_id=%s document_id=%s error=%s",
                        case_id,
                        document_id,
                        exc,
                    )
                    self._update_db_file_processing_state(
                        file_id=db_file_id,
                        status=ProcessingState.error.value,
                        processing_progress=100.0,
                    )
                    self._update_document(job_id, document_id, ProcessingState.error, 100.0, "failed", error=str(exc))

        with self._lock:
            job = self._jobs[job_id]
            job.status = ProcessingState.processed
            if any(item.status == ProcessingState.error for item in job.documents.values()):
                if all(item.status == ProcessingState.error for item in job.documents.values()):
                    job.status = ProcessingState.error
            job.updated_at = datetime.now(tz=UTC)

    def _ensure_case(self, user_id: str, case_id: str) -> StoredCase:
        stored_case = self._pipeline._cases.get(case_id)
        if stored_case:
            return stored_case
        stored_case = StoredCase(case_id=case_id, user_id=user_id, created_at=datetime.now(tz=UTC))
        self._pipeline._cases[case_id] = stored_case
        self._extracted_by_case.setdefault(case_id, {})
        return stored_case

    def _merge_extracted_case_data(self, case_id: str, metadata: dict[str, Any], text: str) -> None:
        extraction = self._pipeline._document_ai.extract(
            DocumentReference(document_name=metadata.get("original_name", "document"), inline_text=text)
        )
        normalized = self._normalize_entities(extraction.entities)
        extracted_data = self._extracted_by_case.setdefault(case_id, {})
        for key, value in normalized.items():
            if value and not extracted_data.get(key):
                extracted_data[key] = value

    def _normalize_entities(self, entities: dict[str, Any]) -> dict[str, Any]:
        """
        Pass through all camelCase fields from Gemini extraction as-is, and map
        any legacy snake_case fields from the old regex extractor for backward compat.
        """
        # Direct camelCase fields that Gemini returns — just copy them through
        camel_case_fields = {
            "caseTitle", "caseNumber", "casePrefix", "caseYear", "caseType", "caseNature",
            "subType", "courtName", "courtLevel", "benchDivision", "jurisdiction", "state",
            "filingDate", "judges", "courtRoom", "petitioners", "respondents",
            "categoryType", "primaryCategory", "subCategory", "complexity",
            "monetaryValue", "priorityLevel", "currentStatus", "nextHearingDate",
            "documentType", "filedBy",
        }
        normalized: dict[str, Any] = {}
        for field in camel_case_fields:
            val = entities.get(field)
            if val is not None and val != "" and val != [] and val != {}:
                normalized[field] = val

        # Legacy snake_case mappings (from old regex extractor fallback)
        if entities.get("case_number") and not normalized.get("caseNumber"):
            normalized["caseNumber"] = entities["case_number"]
        if entities.get("case_type") and not normalized.get("caseType"):
            normalized["caseType"] = entities["case_type"]
        if entities.get("court_details") and not normalized.get("courtName"):
            normalized["courtName"] = entities["court_details"]
            normalized.setdefault("jurisdiction", entities["court_details"])
        if entities.get("important_dates") and not normalized.get("filingDate"):
            normalized["filingDate"] = entities["important_dates"].split(",")[0].strip()
        if entities.get("party_names") and not normalized.get("caseTitle"):
            normalized["caseTitle"] = entities["party_names"]
            lowered = entities["party_names"].lower()
            if " vs " in lowered:
                idx = lowered.index(" vs ")
                left = entities["party_names"][:idx].strip()
                right = entities["party_names"][idx + 4:].strip()
                normalized.setdefault("petitioners", [{"fullName": left, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}] if left else [])
                normalized.setdefault("respondents", [{"fullName": right, "role": "Individual", "advocateName": "", "barRegistration": "", "contact": ""}] if right else [])
        return normalized

    def _get_case_status(self, case_id: str) -> str:
        job_id = self._latest_job_by_case.get(case_id)
        job = self._jobs.get(job_id) if job_id else None
        if not job:
            return "Active"
        if job.status == ProcessingState.error:
            return "Error"
        if job.status == ProcessingState.processed:
            return "Active"
        return "Processing"

    def _list_folders_from_db(self, user_id: str | None) -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        if not accessible_user_ids:
            return []

        # Fetch only folder records joined with cases — same logic as document-service
        folder_query = """
            SELECT
                uf.id,
                uf.user_id,
                uf.originalname,
                uf.folder_path,
                uf.gcs_path,
                uf.created_at,
                c.case_title
            FROM user_files uf
            LEFT JOIN cases c ON uf.id = c.folder_id
            WHERE uf.user_id::text = ANY(%s::text[])
              AND uf.is_folder = true
            ORDER BY uf.created_at DESC
        """
        # Fetch all files (non-folders) in one query for children matching
        files_query = """
            SELECT
                id, user_id, originalname, folder_path, gcs_path,
                mimetype, size, status, processing_progress, created_at
            FROM user_files
            WHERE user_id::text = ANY(%s::text[])
              AND is_folder = false
            ORDER BY originalname ASC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(folder_query, [accessible_user_ids])
            folder_rows = list(cur.fetchall())
            cur.execute(files_query, [accessible_user_ids])
            file_rows = list(cur.fetchall())

        folders = []
        for row in folder_rows:
            folder_path = row.get("folder_path") or ""
            folder_name = row.get("originalname") or ""
            # Mirror document-service File.js logic: robustPath = storedPath/folderName
            # folder_path stores the PARENT path; full path = parent/folderName
            if folder_name and not folder_path.endswith(folder_name):
                full_folder_path = f"{folder_path}/{folder_name}".strip("/") if folder_path else folder_name
            else:
                full_folder_path = folder_path or folder_name

            folder_children = [
                {
                    "id": str(f["id"]),
                    "name": f.get("originalname"),
                    "size": f.get("size") or 0,
                    "mimetype": f.get("mimetype"),
                    "created_at": f["created_at"].isoformat() if f.get("created_at") else "",
                    "folder_path": f.get("folder_path"),
                    "status": f.get("status"),
                    "processing_progress": float(f.get("processing_progress") or 0),
                    "url": f.get("gcs_path"),
                }
                for f in file_rows
                if (
                    f.get("folder_path") == full_folder_path
                    or str(f.get("folder_path") or "").startswith(f"{full_folder_path}/")
                )
            ]
            folders.append(
                {
                    "id": str(row["id"]),
                    "name": folder_name,
                    "case_title": row.get("case_title"),
                    "folder_path": row.get("folder_path") or "",
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                    "children": folder_children,
                    "document_count": len(folder_children),
                }
            )
        return folders

    def _get_documents_in_folder_from_db(self, folder_name: str, user_id: str | None) -> list[dict[str, Any]] | None:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        if not accessible_user_ids:
            return []

        # Select gcs_path too so we can use it for GCS-based file matching below
        folder_query = """
            SELECT id, user_id, folder_path, originalname, gcs_path
            FROM user_files
            WHERE user_id::text = ANY(%s::text[])
              AND is_folder = true
              AND originalname = %s
            ORDER BY created_at DESC
            LIMIT 1
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(folder_query, [accessible_user_ids, folder_name])
            folder = cur.fetchone()
            if not folder:
                # No folder record found — try matching files directly by folder_path or folder path pattern
                # (mirrors document-service File.js findByUserIdAndFolderPath fallback)
                fallback_query = """
                    SELECT *
                    FROM user_files
                    WHERE user_id::text = ANY(%s::text[])
                      AND is_folder = false
                      AND (
                          folder_path = %s
                          OR folder_path LIKE %s
                      )
                    ORDER BY originalname ASC
                """
                cur.execute(fallback_query, [accessible_user_ids, folder_name, f"{folder_name}/%"])
                rows = list(cur.fetchall())
                if not rows:
                    # No folder record and no files found — return None so caller can
                    # fall back to in-memory pipeline storage (e.g. freshly uploaded docs)
                    return None
            else:
                # Mirror document-service File.js findByUserIdAndFolderPath logic:
                # robustPath = storedPath ? `${storedPath}/${folder.originalname}` : folder.originalname
                stored_path = folder.get("folder_path") or ""
                if folder.get("originalname") and not stored_path.endswith(folder["originalname"]):
                    robust_path = f"{stored_path}/{folder['originalname']}".strip("/") if stored_path else folder["originalname"]
                else:
                    robust_path = stored_path or folder.get("originalname") or folder_name

                # Use ANY(%s::text[]) for firm/multi-user support — NOT a single user_id
                gcs_prefix = f"{folder.get('gcs_path')}%" if folder.get("gcs_path") else None
                if gcs_prefix:
                    file_query = """
                        SELECT *
                        FROM user_files
                        WHERE user_id::text = ANY(%s::text[])
                          AND is_folder = false
                          AND (
                              folder_path = %s
                              OR folder_path LIKE %s
                              OR gcs_path LIKE %s
                          )
                        ORDER BY originalname ASC
                    """
                    cur.execute(file_query, [accessible_user_ids, robust_path, f"{robust_path}/%", gcs_prefix])
                else:
                    file_query = """
                        SELECT *
                        FROM user_files
                        WHERE user_id::text = ANY(%s::text[])
                          AND is_folder = false
                          AND (
                              folder_path = %s
                              OR folder_path LIKE %s
                          )
                        ORDER BY originalname ASC
                    """
                    cur.execute(file_query, [accessible_user_ids, robust_path, f"{robust_path}/%"])
                rows = list(cur.fetchall())

        return [
            {
                "id": str(row["id"]),
                "name": row.get("originalname"),
                "originalname": row.get("originalname"),
                "size": row.get("size") or 0,
                "mimetype": row.get("mimetype"),
                "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                "status": row.get("status"),
                "processing_progress": float(row.get("processing_progress") or 0),
                "folder_path": row.get("folder_path"),
                "gcs_path": row.get("gcs_path"),
                "summary": row.get("summary"),
                "full_text_content": row.get("full_text_content"),
            }
            for row in rows
            if not row.get("is_folder")
        ]

    def _list_folders_from_cases_db(self, user_id: str | None) -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            return []

        query = """
            SELECT
                c.id AS case_id,
                c.case_title,
                c.created_at,
                c.folder_id,
                uf.originalname AS folder_name,
                uf.folder_path,
                uf.gcs_path
            FROM cases c
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE c.user_id::text = ANY(%s::text[])
            ORDER BY c.created_at DESC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, [text_user_ids])
            rows = list(cur.fetchall())

        folders: list[dict[str, Any]] = []
        for row in rows:
            folder_name = row.get("folder_name") or row.get("case_title")
            if not folder_name:
                continue
            folders.append(
                {
                    "id": str(row.get("folder_id") or row.get("case_id")),
                    "name": folder_name,
                    "case_title": row.get("case_title") or folder_name,
                    "folder_path": row.get("folder_path") or "",
                    "gcs_path": row.get("gcs_path"),
                    "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
                    "children": [],
                }
            )
        return folders

    def _get_accessible_user_ids(self, user_id: str) -> list[str]:
        normalized_user_id = str(user_id)
        candidate_bases = [settings.auth_service_url, settings.api_gateway_url]
        attempted_sources: list[str] = []
        for base_url in candidate_bases:
            normalized_base = str(base_url or "").rstrip("/")
            if not normalized_base or normalized_base in attempted_sources:
                continue
            attempted_sources.append(normalized_base)
            try:
                response = httpx.get(
                    f"{normalized_base}/api/auth/internal/user/{normalized_user_id}/firm-member-ids",
                    timeout=3.0,
                )
                response.raise_for_status()
                user_ids = response.json().get("user_ids", [])
                if isinstance(user_ids, list) and user_ids:
                    normalized_ids = [str(value) for value in user_ids if value is not None]
                    logger.info(
                        "[FolderService] task=resolve_accessible_users user_id=%s source=%s resolved_ids=%s",
                        normalized_user_id,
                        normalized_base,
                        normalized_ids,
                    )
                    return normalized_ids
            except Exception as exc:
                logger.warning(
                    "[FolderService] task=resolve_accessible_users status=retry user_id=%s source=%s error=%s",
                    normalized_user_id,
                    normalized_base,
                    exc,
                )
        logger.warning(
            "[FolderService] task=resolve_accessible_users status=fallback user_id=%s resolved_ids=%s",
            normalized_user_id,
            [normalized_user_id],
        )
        return [normalized_user_id]

    def _list_cases_from_db(self, user_id: str | None) -> list[dict[str, Any]]:
        if not user_id:
            return []
        accessible_user_ids = self._get_accessible_user_ids(user_id)
        text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
        if not text_user_ids:
            return []
        query = """
            SELECT
                c.*,
                ct.name AS case_type_name,
                st.name AS sub_type_name,
                co.court_name AS court_name_name,
                uf.originalname AS folder_name
            FROM cases c
            LEFT JOIN case_types ct ON
                CASE
                    WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
                    ELSE false
                END
            LEFT JOIN sub_types st ON
                CASE
                    WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
                    ELSE false
                END
            LEFT JOIN courts co ON
                CASE
                    WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
                    ELSE false
                END
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE c.user_id::text = ANY(%s::text[])
            ORDER BY c.created_at DESC
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, [text_user_ids])
            rows = list(cur.fetchall())
        return [self._serialize_case_row(row) for row in rows]

    def _get_case_from_db(self, case_id: str, user_id: str | None) -> dict[str, Any] | None:
        conditions = ["c.id::text = %s"]
        params: list[Any] = [case_id]
        if user_id:
            accessible_user_ids = self._get_accessible_user_ids(user_id)
            text_user_ids = [str(value) for value in accessible_user_ids if value is not None]
            if not text_user_ids:
                return None
            conditions.append("c.user_id::text = ANY(%s::text[])")
            params.append(text_user_ids)
        where_clause = " AND ".join(conditions)
        query = f"""
            SELECT
                c.*,
                ct.name AS case_type_name,
                st.name AS sub_type_name,
                co.court_name AS court_name_name,
                uf.originalname AS folder_name
            FROM cases c
            LEFT JOIN case_types ct ON
                CASE
                    WHEN c.case_type ~ '^[0-9]+$' THEN c.case_type::integer = ct.id
                    ELSE false
                END
            LEFT JOIN sub_types st ON
                CASE
                    WHEN c.sub_type ~ '^[0-9]+$' THEN c.sub_type::integer = st.id
                    ELSE false
                END
            LEFT JOIN courts co ON
                CASE
                    WHEN c.court_name ~ '^[0-9]+$' THEN c.court_name::integer = co.id
                    ELSE false
                END
            LEFT JOIN user_files uf ON uf.id = c.folder_id
            WHERE {where_clause}
            LIMIT 1
        """
        with get_db_connection() as conn, conn.cursor() as cur:
            cur.execute(query, params)
            row = cur.fetchone()
        return self._serialize_case_row(row) if row else None

    def _serialize_case_row(self, row: dict[str, Any]) -> dict[str, Any]:
        petitioners = self._parse_jsonish_list(row.get("petitioners"))
        respondents = self._parse_jsonish_list(row.get("respondents"))
        judges = self._parse_jsonish_list(row.get("judges"))
        return {
            "id": str(row["id"]),
            "folder_id": str(row["folder_id"]) if row.get("folder_id") else row.get("folder_name") or str(row["id"]),
            "folder_name": row.get("folder_name") or row.get("case_title"),
            "name": row.get("case_title") or row.get("folder_name"),
            "case_title": row.get("case_title"),
            "case_number": row.get("case_number"),
            "filing_date": row.get("filing_date").isoformat() if row.get("filing_date") else None,
            "case_type": row.get("case_type_name") or row.get("case_type"),
            "sub_type": row.get("sub_type_name") or row.get("sub_type"),
            "court_name": row.get("court_name_name") or row.get("court_name"),
            "court_level": row.get("court_level"),
            "bench_division": row.get("bench_division"),
            "jurisdiction": row.get("jurisdiction"),
            "state": row.get("state"),
            "court_room_no": row.get("court_room_no"),
            "category_type": row.get("category_type"),
            "primary_category": row.get("primary_category"),
            "sub_category": row.get("sub_category"),
            "complexity": row.get("complexity"),
            "monetary_value": row.get("monetary_value"),
            "priority_level": row.get("priority_level"),
            "status": row.get("status") or "Active",
            "case_prefix": row.get("case_prefix"),
            "case_year": row.get("case_year"),
            "case_nature": row.get("case_nature"),
            "next_hearing_date": row.get("next_hearing_date").isoformat() if row.get("next_hearing_date") else None,
            "document_type": row.get("document_type"),
            "filed_by": row.get("filed_by"),
            "judges": judges,
            "petitioners": petitioners,
            "respondents": respondents,
            "created_at": row["created_at"].isoformat() if row.get("created_at") else "",
            "updated_at": row["updated_at"].isoformat() if row.get("updated_at") else "",
        }

    def _parse_jsonish_list(self, value: Any) -> list[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return []
            try:
                parsed = json.loads(text)
            except Exception:
                return []
            return parsed if isinstance(parsed, list) else []
        return []

    def _update_document(
        self,
        job_id: str,
        document_id: str,
        status: ProcessingState,
        progress: float,
        operation: str,
        *,
        error: str | None = None,
        doc_type: Any = None,
        stored_document_uri: str | None = None,
        chunk_count: int | None = None,
        quality_score: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._lock:
            job = self._jobs[job_id]
            current = job.documents[document_id]
            job.documents[document_id] = current.model_copy(
                update={
                    "status": status,
                    "processing_progress": progress,
                    "current_operation": operation,
                    "error": error,
                    "doc_type": doc_type if doc_type is not None else current.doc_type,
                    "stored_document_uri": stored_document_uri or current.stored_document_uri,
                    "chunk_count": chunk_count if chunk_count is not None else current.chunk_count,
                    "quality_score": quality_score if quality_score is not None else current.quality_score,
                    "metadata": metadata if metadata is not None else current.metadata,
                    "updated_at": datetime.now(tz=UTC),
                }
            )
            job.updated_at = datetime.now(tz=UTC)

    def _get_or_create_session(
        self,
        user_id: str,
        folder_name: str,
        session_id: str | None,
        question: str,
    ) -> ChatSessionRecord:
        with self._lock:
            folder_sessions = self._sessions.setdefault(folder_name, {})
            if session_id and session_id in folder_sessions:
                return folder_sessions[session_id]
            now = datetime.now(tz=UTC)
            session = ChatSessionRecord(
                id=session_id or str(uuid.uuid4()),
                case_id=folder_name,
                user_id=user_id,
                folder_name=folder_name,
                title=(question[:60] or "Case chat").strip(),
                created_at=now,
                updated_at=now,
            )
            folder_sessions[session.id] = session
            return session

    def _save_folder_chat_to_db(
        self,
        *,
        user_id: str,
        folder_name: str,
        question: str,
        answer: str,
        session_id: str,
        citations: list[Any],
        used_secret_prompt: bool = False,
        prompt_label: str | None = None,
        secret_id: str | None = None,
    ) -> None:
        if not is_db_available():
            return
        chunk_ids = []
        summarized_file_ids = []
        normalized_citations = []
        uuid_re = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        for citation in citations or []:
            as_dict = citation.model_dump(mode="json") if hasattr(citation, "model_dump") else dict(citation)
            normalized_citations.append(as_dict)
            cid = as_dict.get("chunk_id")
            fid = as_dict.get("document_id")
            if cid and uuid_re.match(str(cid)):
                chunk_ids.append(str(cid))
            if fid and uuid_re.match(str(fid)):
                summarized_file_ids.append(str(fid))
        secret_uuid = None
        if secret_id and uuid_re.match(str(secret_id)):
            secret_uuid = str(secret_id)
        try:
            with get_db_connection() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO folder_chats
                      (id, user_id, folder_name, question, answer, summarized_file_ids, used_chunk_ids, session_id,
                       used_secret_prompt, prompt_label, secret_id, chat_history, citations, created_at)
                    VALUES
                      (%s::uuid, %s, %s, %s, %s, %s::uuid[], %s::uuid[], %s::uuid,
                       %s, %s, %s::uuid, %s::jsonb, %s::jsonb, NOW())
                    """,
                    (
                        str(uuid.uuid4()),
                        str(user_id),
                        folder_name,
                        question,
                        answer,
                        [item for item in summarized_file_ids if item],
                        [item for item in chunk_ids if item],
                        session_id if re.match(r"^[0-9a-fA-F-]{36}$", session_id or "") else str(uuid.uuid4()),
                        used_secret_prompt,
                        prompt_label if used_secret_prompt else None,
                        secret_uuid,
                        json.dumps([]),
                        json.dumps(normalized_citations),
                    ),
                )
                conn.commit()
        except Exception as exc:
            logger.exception(
                "[FolderService] task=save_folder_chat_db status=error folder=%s session_id=%s error=%s",
                folder_name,
                session_id,
                exc,
            )

    def _append_message(self, session: ChatSessionRecord, role: str, content: str) -> None:
        with self._lock:
            session.messages.append(
                ChatMessage(
                    id=f"msg-{uuid.uuid4().hex[:12]}",
                    role=role,
                    content=content,
                    created_at=datetime.now(tz=UTC),
                    metadata={},
                )
            )
            session.updated_at = datetime.now(tz=UTC)

    def _to_session_model(self, session: ChatSessionRecord) -> ChatSession:
        return ChatSession(
            id=session.id,
            case_id=session.case_id,
            folderName=session.folder_name,
            title=session.title,
            created_at=session.created_at,
            updated_at=session.updated_at,
            messages=session.messages,
        )

    def _record_prompt(
        self,
        *,
        case_id: str,
        user_id: str,
        kind: PromptRecordKind,
        prompt_text: str | None,
        metadata: dict[str, Any],
        secret_prompt: bool,
    ) -> None:
        with self._lock:
            self._prompt_audit.append(
                PromptAuditRecord(
                    id=f"prompt-{uuid.uuid4().hex[:12]}",
                    case_id=case_id,
                    user_id=user_id,
                    kind=kind,
                    prompt_text=None if secret_prompt else prompt_text,
                    stored=not secret_prompt,
                    redacted=secret_prompt,
                    metadata=metadata,
                    created_at=datetime.now(tz=UTC),
                )
            )

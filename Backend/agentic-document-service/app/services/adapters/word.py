from __future__ import annotations

import io
import zipfile
from xml.etree import ElementTree


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC_MIME = "application/msword"


def is_word_mime(mime_type: str | None) -> bool:
    raw = str(mime_type or "").strip().lower()
    return raw in {DOCX_MIME, DOC_MIME}


def is_word_filename(filename: str | None) -> bool:
    raw = str(filename or "").strip().lower()
    return raw.endswith(".docx") or raw.endswith(".doc")


def looks_like_docx_zip(data: bytes) -> bool:
    return len(data) >= 4 and data[:2] == b"PK"


def extract_docx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        document_xml = archive.read("word/document.xml")

    root = ElementTree.fromstring(document_xml)
    namespace = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    paragraphs: list[str] = []
    for paragraph in root.findall(".//w:p", namespace):
        runs = [node.text for node in paragraph.findall(".//w:t", namespace) if node.text]
        text = "".join(runs).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


def extract_word_text(data: bytes, *, mime_type: str | None = None, filename: str | None = None) -> str | None:
    raw_mime = str(mime_type or "").strip().lower()
    raw_name = str(filename or "").strip().lower()

    if raw_name.endswith(".docx") or raw_mime == DOCX_MIME:
        return extract_docx_text(data)

    # Some clients upload DOCX bytes but label them as .doc / application-msword.
    if (raw_name.endswith(".doc") or raw_mime == DOC_MIME) and looks_like_docx_zip(data):
        return extract_docx_text(data)

    return None

from __future__ import annotations

import re
from dataclasses import dataclass


HEADING_RE = re.compile(
    r"^(?:"
    r"(?:section|article|chapter|clause|appendix)\s+[A-Z0-9IVXLC]+"
    r"|[A-Z][A-Z0-9 ,.'&()/-]{6,}"
    r"|\d+(?:\.\d+)*[.)]?\s+[A-Z].+"
    r")$"
)


@dataclass(slots=True)
class ChunkSection:
    heading: str | None
    text: str


class LegalSemanticChunker:
    def __init__(self, target_tokens: int, overlap_tokens: int, min_tokens: int, max_tokens: int) -> None:
        self.target_tokens = max(500, target_tokens)
        self.overlap_tokens = max(0, overlap_tokens)
        self.min_tokens = max(150, min_tokens)
        self.max_tokens = max(self.target_tokens, max_tokens)

    def chunk(self, text: str) -> list[ChunkSection]:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n").strip()
        if not normalized:
            return []

        sections = self._split_sections(normalized)
        chunks: list[ChunkSection] = []

        for section in sections:
            section_tokens = self._estimate_tokens(section.text)
            if section_tokens <= self.max_tokens:
                chunks.append(section)
                continue
            chunks.extend(self._split_large_section(section))

        return self._merge_small_chunks(chunks)

    def _split_sections(self, text: str) -> list[ChunkSection]:
        lines = [line.rstrip() for line in text.split("\n")]
        sections: list[ChunkSection] = []
        current_heading: str | None = None
        current_lines: list[str] = []

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                current_lines.append("")
                continue

            if self._is_heading(line):
                if any(part.strip() for part in current_lines):
                    sections.append(
                        ChunkSection(
                            heading=current_heading,
                            text="\n".join(current_lines).strip(),
                        )
                    )
                    current_lines = []
                current_heading = line
                continue

            current_lines.append(line)

        if current_heading or any(part.strip() for part in current_lines):
            sections.append(
                ChunkSection(
                    heading=current_heading,
                    text="\n".join(current_lines).strip(),
                )
            )

        return [section for section in sections if section.text.strip()]

    def _split_large_section(self, section: ChunkSection) -> list[ChunkSection]:
        paragraphs = [part.strip() for part in re.split(r"\n\s*\n", section.text) if part.strip()]
        if not paragraphs:
            return [section]

        chunks: list[ChunkSection] = []
        current_parts: list[str] = []
        current_tokens = 0

        for paragraph in paragraphs:
            paragraph_tokens = self._estimate_tokens(paragraph)
            if current_parts and current_tokens + paragraph_tokens > self.target_tokens:
                chunk_text = "\n\n".join(current_parts).strip()
                chunks.append(ChunkSection(heading=section.heading, text=chunk_text))
                overlap_text = self._tail_words(chunk_text, self.overlap_tokens)
                current_parts = [overlap_text, paragraph] if overlap_text else [paragraph]
                current_tokens = self._estimate_tokens("\n\n".join(current_parts))
            else:
                current_parts.append(paragraph)
                current_tokens += paragraph_tokens

        if current_parts:
            chunks.append(ChunkSection(heading=section.heading, text="\n\n".join(current_parts).strip()))

        return chunks

    def _merge_small_chunks(self, chunks: list[ChunkSection]) -> list[ChunkSection]:
        if not chunks:
            return []

        merged: list[ChunkSection] = []
        current = chunks[0]

        for nxt in chunks[1:]:
            current_tokens = self._estimate_tokens(current.text)
            next_tokens = self._estimate_tokens(nxt.text)
            same_heading = current.heading == nxt.heading
            if same_heading and current_tokens < self.min_tokens and current_tokens + next_tokens <= self.max_tokens:
                current = ChunkSection(
                    heading=current.heading,
                    text=f"{current.text}\n\n{nxt.text}".strip(),
                )
            else:
                merged.append(current)
                current = nxt

        merged.append(current)
        return merged

    @staticmethod
    def _estimate_tokens(text: str) -> int:
        return max(1, int(len(text.split()) * 1.3))

    @staticmethod
    def _tail_words(text: str, token_target: int) -> str:
        if token_target <= 0:
            return ""
        words = text.split()
        keep = min(len(words), max(1, token_target))
        return " ".join(words[-keep:])

    @staticmethod
    def _is_heading(line: str) -> bool:
        if len(line) > 160:
            return False
        return bool(HEADING_RE.match(line.strip()))

import re
from dataclasses import dataclass, field
from typing import Any


TOKEN_RE = re.compile(r"\b[\w'-]+\b")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.+)$")


@dataclass
class Chunk:
    chunk_index: int
    heading: str | None
    content: str
    token_count: int
    metadata: dict[str, Any] = field(default_factory=dict)


def chunk_text(text: str, target_tokens: int = 650, overlap_tokens: int = 90) -> list[Chunk]:
    """MVP markdown/plain-text chunking with heading carry-forward and overlap."""
    sections = _split_sections(text)
    chunks: list[Chunk] = []

    for heading, body in sections:
        section_tokens = _tokens(body)
        if not section_tokens:
            continue

        if len(section_tokens) <= target_tokens:
            chunks.append(
                Chunk(
                    chunk_index=len(chunks),
                    heading=heading,
                    content=body.strip(),
                    token_count=len(section_tokens),
                    metadata={"chunker": "markdown-section"},
                )
            )
            continue

        start = 0
        while start < len(section_tokens):
            window = section_tokens[start : start + target_tokens]
            if not window:
                break
            chunks.append(
                Chunk(
                    chunk_index=len(chunks),
                    heading=heading,
                    content=" ".join(window),
                    token_count=len(window),
                    metadata={"chunker": "markdown-section-window"},
                )
            )
            if start + target_tokens >= len(section_tokens):
                break
            start += max(1, target_tokens - overlap_tokens)

    return chunks


def _split_sections(text: str) -> list[tuple[str | None, str]]:
    sections: list[tuple[str | None, list[str]]] = []
    active_heading: str | None = None
    active_lines: list[str] = []

    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = raw_line.rstrip()
        match = HEADING_RE.match(line.strip())
        if match:
            if active_lines:
                sections.append((active_heading, active_lines))
                active_lines = []
            active_heading = match.group(2).strip()
            continue
        active_lines.append(line)

    if active_lines:
        sections.append((active_heading, active_lines))

    cleaned = []
    for heading, lines in sections:
        body = "\n".join(lines).strip()
        if body:
            cleaned.append((heading, body))
    return cleaned


def _tokens(text: str) -> list[str]:
    return TOKEN_RE.findall(text)

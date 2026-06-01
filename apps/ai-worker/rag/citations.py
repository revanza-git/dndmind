from typing import Any


def citation_from_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": row.get("source_type", "rules"),
        "title": row["title"],
        "heading": row.get("heading"),
        "chunkId": str(row["chunk_id"]),
        "documentId": str(row["document_id"]),
        "score": row.get("score"),
        "snippet": _snippet(row["content"]),
    }


def _snippet(content: str, limit: int = 220) -> str:
    collapsed = " ".join(content.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + "..."


from typing import Any

from rag.retriever import search_homebrew, search_memory, search_rules


def search_rules_tool(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("query is required.")
    campaign_id = (context or {}).get("campaignId")
    rows = search_rules(campaign_id, query, int(arguments.get("limit", 5)))
    return {"query": query, "results": _serialize_rows(rows), "citations": [row["citation"] for row in rows]}


def search_homebrew_tool(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("query is required.")
    campaign_id = (context or {}).get("campaignId")
    rows = search_homebrew(campaign_id, query, int(arguments.get("limit", 5)))
    return {"query": query, "results": _serialize_rows(rows), "citations": [row["citation"] for row in rows]}


def search_campaign_memory_tool(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    query = str(arguments.get("query") or "").strip()
    trusted_context = context or {}
    campaign_id = trusted_context.get("campaignId")
    client_owner_id = trusted_context.get("clientOwnerId")
    if not query:
        raise ValueError("query is required.")
    if not campaign_id:
        raise ValueError("campaignId is required.")
    if not client_owner_id:
        raise ValueError("clientOwnerId is required.")
    rows = search_memory(campaign_id, query, int(arguments.get("limit", 5)), client_owner_id)
    return {"query": query, "results": _serialize_rows(rows), "citations": [row["citation"] for row in rows]}


def _serialize_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "chunkId": str(row["chunk_id"]),
            "documentId": str(row["document_id"]),
            "title": row["title"],
            "sourceType": row.get("source_type"),
            "heading": row.get("heading"),
            "content": row["content"],
            "score": row.get("score"),
            "citation": row["citation"],
        }
        for row in rows
    ]

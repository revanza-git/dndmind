import os
from typing import Any
from uuid import UUID

import psycopg
from psycopg.rows import dict_row

from .citations import citation_from_row
from .embeddings import embed_query, vector_literal


def database_url() -> str:
    return os.getenv("POSTGRES_DSN") or os.getenv("DATABASE_URL", "postgresql://dndmind:dndmind@localhost:5432/dndmind")


def search_rules(campaign_id: UUID | None, query: str, limit: int = 5) -> list[dict[str, Any]]:
    return _search_chunks(campaign_id, query, limit, ["rules", "srd"], include_global=True)


def search_homebrew(campaign_id: UUID | None, query: str, limit: int = 5) -> list[dict[str, Any]]:
    return _search_chunks(campaign_id, query, limit, ["homebrew"], include_global=True)


def search_memory(campaign_id: UUID, query: str, limit: int = 5, client_owner_id: str | None = None) -> list[dict[str, Any]]:
    if not client_owner_id:
        return []
    return _search_chunks(campaign_id, query, limit, ["campaign_memory"], include_global=False, client_owner_id=client_owner_id)


def _search_chunks(
    campaign_id: UUID | None,
    query: str,
    limit: int,
    source_types: list[str],
    include_global: bool,
    client_owner_id: str | None = None,
) -> list[dict[str, Any]]:
    embedding = vector_literal(embed_query(query))
    sql = """
        SELECT
          kc.id AS chunk_id,
          kc.document_id,
          kc.campaign_id,
          kc.source_type,
          kc.heading,
          kc.content,
          kc.token_count,
          kd.title,
          1 - (kc.embedding <=> %(embedding)s::vector) AS score
        FROM knowledge_chunks kc
        JOIN knowledge_documents kd ON kd.id = kc.document_id
        WHERE kc.embedding IS NOT NULL
          AND kc.source_type = ANY(%(source_types)s::text[])
          AND (
            (%(include_global)s AND (%(campaign_id)s::uuid IS NULL OR kc.campaign_id IS NULL OR kc.campaign_id = %(campaign_id)s::uuid))
            OR (NOT %(include_global)s AND kc.campaign_id = %(campaign_id)s::uuid)
          )
          AND (
            kc.source_type <> 'campaign_memory'
            OR kc.metadata->>'clientOwnerId' = %(client_owner_id)s
          )
        ORDER BY kc.embedding <=> %(embedding)s::vector
        LIMIT %(limit)s
    """

    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        rows = conn.execute(
            sql,
            {
                "embedding": embedding,
                "campaign_id": campaign_id,
                "source_types": source_types,
                "include_global": include_global,
                "client_owner_id": client_owner_id,
                "limit": max(1, min(limit, 12)),
            },
        ).fetchall()

    positive_rows = [row for row in rows if float(row.get("score") or 0) > 0]
    return [dict(row) | {"citation": citation_from_row(row)} for row in positive_rows]


def format_rules_context(rows: list[dict[str, Any]]) -> str:
    return _format_context(rows)


def format_memory_context(rows: list[dict[str, Any]]) -> str:
    return _format_context(rows)


def _format_context(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return ""

    blocks = []
    for index, row in enumerate(rows, start=1):
        heading = f" - {row['heading']}" if row.get("heading") else ""
        blocks.append(f"[{index}] {row['title']}{heading}\n{row['content']}")
    return "\n\n".join(blocks)

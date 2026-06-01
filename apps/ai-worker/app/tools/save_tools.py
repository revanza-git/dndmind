import json
from typing import Any

import psycopg
from psycopg.rows import dict_row

from rag.chunker import chunk_text
from rag.embeddings import embed_texts, vector_literal
from rag.retriever import database_url


def save_npc(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    campaign_id = arguments.get("campaignId") or (context or {}).get("campaignId")
    name = str(arguments.get("name") or "").strip()
    if not campaign_id or not name:
        raise ValueError("campaignId and name are required.")

    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        row = conn.execute(
            """
            INSERT INTO npcs (campaign_id, name, role, description, disposition, metadata)
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (campaign_id, name) DO UPDATE
            SET role = COALESCE(EXCLUDED.role, npcs.role),
                description = COALESCE(EXCLUDED.description, npcs.description),
                disposition = COALESCE(EXCLUDED.disposition, npcs.disposition),
                metadata = npcs.metadata || EXCLUDED.metadata
            RETURNING id, name
            """,
            (
                campaign_id,
                name,
                arguments.get("role"),
                arguments.get("description"),
                arguments.get("disposition"),
                json.dumps(arguments.get("metadata") or {}),
            ),
        ).fetchone()
        conn.commit()
    return {"id": str(row["id"]), "name": row["name"]}


def save_quest(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    campaign_id = arguments.get("campaignId") or (context or {}).get("campaignId")
    title = str(arguments.get("title") or "").strip()
    if not campaign_id or not title:
        raise ValueError("campaignId and title are required.")

    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        row = conn.execute(
            """
            INSERT INTO quests (campaign_id, title, status, description, metadata)
            VALUES (%s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (campaign_id, title) DO UPDATE
            SET status = EXCLUDED.status,
                description = COALESCE(EXCLUDED.description, quests.description),
                metadata = quests.metadata || EXCLUDED.metadata
            RETURNING id, title
            """,
            (
                campaign_id,
                title,
                arguments.get("status") or "open",
                arguments.get("description"),
                json.dumps(arguments.get("metadata") or {}),
            ),
        ).fetchone()
        conn.commit()
    return {"id": str(row["id"]), "title": row["title"]}


def save_session_summary(arguments: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    campaign_id = arguments.get("campaignId") or (context or {}).get("campaignId")
    session_id = arguments.get("sessionId")
    summary = str(arguments.get("summary") or "").strip()
    if not campaign_id or not session_id or not summary:
        raise ValueError("campaignId, sessionId, and summary are required.")

    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        conn.execute("UPDATE sessions SET summary = %s, status = 'summarized' WHERE id = %s AND campaign_id = %s", (summary, session_id, campaign_id))
        document = conn.execute(
            """
            INSERT INTO knowledge_documents (campaign_id, source_type, title, content, metadata)
            VALUES (%s, 'campaign_memory', %s, %s, %s::jsonb)
            RETURNING id
            """,
            (
                campaign_id,
                arguments.get("title") or "Saved Session Summary",
                f"# Saved Session Summary\n\n{summary}",
                json.dumps({"status": "uploaded", "sessionId": session_id, "source": "tool"}),
            ),
        ).fetchone()
        chunks = chunk_text(summary)
        embeddings = embed_texts([chunk.content for chunk in chunks])
        for chunk, embedding in zip(chunks, embeddings):
            conn.execute(
                """
                INSERT INTO knowledge_chunks (document_id, campaign_id, source_type, chunk_index, heading, content, token_count, embedding, metadata)
                VALUES (%s, %s, 'campaign_memory', %s, %s, %s, %s, %s::vector, %s::jsonb)
                """,
                (
                    document["id"],
                    campaign_id,
                    chunk.chunk_index,
                    chunk.heading,
                    chunk.content,
                    chunk.token_count,
                    vector_literal(embedding),
                    json.dumps({"source": "tool"}),
                ),
            )
        conn.commit()
    return {"sessionId": str(session_id), "memoryDocumentId": str(document["id"])}


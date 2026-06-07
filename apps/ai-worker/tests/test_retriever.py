import unittest
from unittest.mock import patch
from uuid import uuid4

from rag import retriever


class FakeRetrieverConnection:
    def __init__(self, rows):
        self.rows = rows

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params):
        required_fragments = [
            "kc.campaign_id = %(campaign_id)s::uuid",
            "kd.campaign_id = %(campaign_id)s::uuid",
            "kc.metadata->>'clientOwnerId' = %(client_owner_id)s",
            "kd.metadata->>'clientOwnerId' = %(client_owner_id)s",
        ]
        for fragment in required_fragments:
            if fragment not in sql:
                raise AssertionError(f"missing campaign-memory scope filter: {fragment}")

        campaign_id = params["campaign_id"]
        client_owner_id = params["client_owner_id"]
        filtered = [
            row
            for row in self.rows
            if row["kc_campaign_id"] == campaign_id
            and row["kd_campaign_id"] == campaign_id
            and row["kc_client_owner_id"] == client_owner_id
            and row["kd_client_owner_id"] == client_owner_id
        ]
        return FakeRetrieverCursor(
            [
                {
                    "chunk_id": row["chunk_id"],
                    "document_id": row["document_id"],
                    "campaign_id": row["kc_campaign_id"],
                    "source_type": "campaign_memory",
                    "heading": row["heading"],
                    "content": row["content"],
                    "token_count": 12,
                    "title": row["title"],
                    "score": 0.9,
                }
                for row in filtered
            ]
        )


class FakeRetrieverCursor:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows


class RetrieverTests(unittest.TestCase):
    def test_campaign_memory_search_requires_matching_chunk_and_document_scope(self):
        campaign_id = uuid4()
        other_campaign_id = uuid4()
        matching_chunk_id = uuid4()
        rows = [
            {
                "chunk_id": matching_chunk_id,
                "document_id": uuid4(),
                "kc_campaign_id": campaign_id,
                "kd_campaign_id": campaign_id,
                "kc_client_owner_id": "owner-a",
                "kd_client_owner_id": "owner-a",
                "heading": "Betrayal",
                "content": "Captain Vey betrayed the party.",
                "title": "Session memory",
            },
            {
                "chunk_id": uuid4(),
                "document_id": uuid4(),
                "kc_campaign_id": other_campaign_id,
                "kd_campaign_id": campaign_id,
                "kc_client_owner_id": "owner-a",
                "kd_client_owner_id": "owner-a",
                "heading": "Wrong chunk campaign",
                "content": "Should not be returned.",
                "title": "Mismatched memory",
            },
            {
                "chunk_id": uuid4(),
                "document_id": uuid4(),
                "kc_campaign_id": campaign_id,
                "kd_campaign_id": other_campaign_id,
                "kc_client_owner_id": "owner-a",
                "kd_client_owner_id": "owner-a",
                "heading": "Wrong document campaign",
                "content": "Should not be returned.",
                "title": "Mismatched memory",
            },
            {
                "chunk_id": uuid4(),
                "document_id": uuid4(),
                "kc_campaign_id": campaign_id,
                "kd_campaign_id": campaign_id,
                "kc_client_owner_id": "owner-b",
                "kd_client_owner_id": "owner-a",
                "heading": "Wrong chunk owner",
                "content": "Should not be returned.",
                "title": "Mismatched memory",
            },
            {
                "chunk_id": uuid4(),
                "document_id": uuid4(),
                "kc_campaign_id": campaign_id,
                "kd_campaign_id": campaign_id,
                "kc_client_owner_id": "owner-a",
                "kd_client_owner_id": "owner-b",
                "heading": "Wrong document owner",
                "content": "Should not be returned.",
                "title": "Mismatched memory",
            },
        ]

        with (
            patch("rag.retriever.embed_query", return_value=[0.1]),
            patch("rag.retriever.vector_literal", return_value="[0.1]"),
            patch("rag.retriever.citation_from_row", return_value={"source": "campaign-memory"}),
            patch("rag.retriever.psycopg.connect", return_value=FakeRetrieverConnection(rows)),
        ):
            results = retriever.search_memory(campaign_id, "Captain Vey", 8, "owner-a")

        self.assertEqual([row["chunk_id"] for row in results], [matching_chunk_id])


if __name__ == "__main__":
    unittest.main()

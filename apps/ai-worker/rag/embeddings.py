import hashlib
import math
import os
import re
from typing import Iterable

import httpx


EMBEDDING_DIMENSIONS = 1536
TOKEN_RE = re.compile(r"\b[a-z0-9][a-z0-9'-]*\b", re.IGNORECASE)


def embed_texts(texts: Iterable[str]) -> list[list[float]]:
    text_list = list(texts)
    if mock_embeddings_enabled():
        return [mock_embedding(text) for text in text_list]
    return openai_embeddings(text_list)


def embed_query(text: str) -> list[float]:
    return embed_texts([text])[0]


def mock_embedding(text: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIMENSIONS
    for token in TOKEN_RE.findall(text.lower()):
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        index = int.from_bytes(digest[:4], "big") % EMBEDDING_DIMENSIONS
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign

    norm = math.sqrt(sum(value * value for value in vector))
    if norm == 0:
        return vector
    return [round(value / norm, 6) for value in vector]


def openai_embeddings(texts: list[str]) -> list[list[float]]:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required when MOCK_LLM=false.")

    model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    response = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": model, "input": texts, "dimensions": EMBEDDING_DIMENSIONS},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return [item["embedding"] for item in sorted(payload["data"], key=lambda item: item["index"])]


def mock_llm_enabled() -> bool:
    return os.getenv("MOCK_LLM", "true").lower() in {"1", "true", "yes", "on"}


def mock_embeddings_enabled() -> bool:
    if "MOCK_EMBEDDINGS" in os.environ:
        return os.getenv("MOCK_EMBEDDINGS", "true").lower() in {"1", "true", "yes", "on"}
    return mock_llm_enabled()


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"

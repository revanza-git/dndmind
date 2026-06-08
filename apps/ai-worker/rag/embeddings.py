import hashlib
import math
import os
import re
from urllib.parse import quote
from typing import Iterable

import httpx


EMBEDDING_DIMENSIONS = 1536
TOKEN_RE = re.compile(r"\b[a-z0-9][a-z0-9'-]*\b", re.IGNORECASE)
EMBEDDING_TASK_DOCUMENT = "RETRIEVAL_DOCUMENT"
EMBEDDING_TASK_QUERY = "RETRIEVAL_QUERY"


def embed_texts(texts: Iterable[str], task_type: str = EMBEDDING_TASK_DOCUMENT) -> list[list[float]]:
    text_list = list(texts)
    if not text_list:
        return []
    if mock_embeddings_enabled():
        return [mock_embedding(text) for text in text_list]

    provider = embedding_provider()
    if provider == "gemini":
        return gemini_embeddings(text_list, task_type)
    if provider == "vertex":
        return vertex_embeddings(text_list, task_type)
    if provider == "openai":
        return openai_embeddings(text_list)
    raise RuntimeError(f"Unsupported EMBEDDING_PROVIDER '{provider}'. Use gemini, vertex, or openai.")


def embed_query(text: str) -> list[float]:
    return embed_texts([text], EMBEDDING_TASK_QUERY)[0]


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
        raise RuntimeError("OPENAI_API_KEY is required when MOCK_EMBEDDINGS=false.")

    model = embedding_model_name()
    response = httpx.post(
        "https://api.openai.com/v1/embeddings",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": model, "input": texts, "dimensions": EMBEDDING_DIMENSIONS},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return [item["embedding"] for item in sorted(payload["data"], key=lambda item: item["index"])]


def gemini_embeddings(texts: list[str], task_type: str) -> list[list[float]]:
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is required when MOCK_EMBEDDINGS=false and EMBEDDING_PROVIDER=gemini.")

    dimensions = int(os.getenv("GEMINI_EMBEDDING_DIMENSIONS", str(EMBEDDING_DIMENSIONS)))
    if dimensions != EMBEDDING_DIMENSIONS:
        raise RuntimeError(
            f"GEMINI_EMBEDDING_DIMENSIONS must be {EMBEDDING_DIMENSIONS} to match the current pgvector schema."
        )

    model = embedding_model_name()
    model_path = model if model.startswith("models/") else f"models/{model}"
    requests = [
        {
            "model": model_path,
            "content": {"parts": [{"text": text}]},
            "taskType": task_type,
            "outputDimensionality": dimensions,
            "embedContentConfig": {
                "taskType": task_type,
                "outputDimensionality": dimensions,
            },
        }
        for text in texts
    ]
    response = httpx.post(
        f"https://generativelanguage.googleapis.com/v1beta/{model_path}:batchEmbedContents",
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        json={"requests": requests},
        timeout=float(os.getenv("GEMINI_EMBEDDING_TIMEOUT_SECONDS", "45")),
    )
    response.raise_for_status()
    payload = response.json()
    embeddings = [item.get("values") for item in payload.get("embeddings", [])]
    if len(embeddings) != len(texts) or any(not isinstance(item, list) for item in embeddings):
        raise RuntimeError("Gemini embeddings response did not include one embedding vector per input text.")
    for embedding in embeddings:
        if len(embedding) != EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"Gemini returned {len(embedding)} embedding dimensions, but the database expects {EMBEDDING_DIMENSIONS}. "
                "Keep GEMINI_EMBEDDING_DIMENSIONS=1536 or update the pgvector schema."
            )
    return embeddings


def vertex_embeddings(texts: list[str], task_type: str) -> list[list[float]]:
    dimensions = int(os.getenv("VERTEX_EMBEDDING_DIMENSIONS", os.getenv("GEMINI_EMBEDDING_DIMENSIONS", str(EMBEDDING_DIMENSIONS))))
    if dimensions != EMBEDDING_DIMENSIONS:
        raise RuntimeError(
            f"VERTEX_EMBEDDING_DIMENSIONS must be {EMBEDDING_DIMENSIONS} to match the current pgvector schema."
        )

    endpoint = vertex_embedding_endpoint()
    token = vertex_access_token()
    embeddings: list[list[float]] = []
    for text in texts:
        response = httpx.post(
            endpoint,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "instances": [{"content": text, "task_type": task_type}],
                "parameters": {"outputDimensionality": dimensions},
            },
            timeout=float(os.getenv("VERTEX_EMBEDDING_TIMEOUT_SECONDS", os.getenv("GEMINI_EMBEDDING_TIMEOUT_SECONDS", "45"))),
        )
        response.raise_for_status()
        payload = response.json()
        vector = extract_vertex_embedding(payload)
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise RuntimeError(
                f"Vertex returned {len(vector)} embedding dimensions, but the database expects {EMBEDDING_DIMENSIONS}. "
                "Keep VERTEX_EMBEDDING_DIMENSIONS=1536 or update the pgvector schema."
            )
        embeddings.append(vector)
    return embeddings


def vertex_embedding_endpoint() -> str:
    project_id = str(os.getenv("VERTEX_PROJECT_ID") or "").strip()
    if not project_id:
        raise RuntimeError("VERTEX_PROJECT_ID is required when MOCK_EMBEDDINGS=false and EMBEDDING_PROVIDER=vertex.")

    location = str(os.getenv("VERTEX_EMBEDDING_LOCATION") or os.getenv("VERTEX_LOCATION") or "global").strip()
    if not location:
        raise RuntimeError("VERTEX_LOCATION is required when MOCK_EMBEDDINGS=false and EMBEDDING_PROVIDER=vertex.")

    model = vertex_embedding_model_id()
    base_url = "https://aiplatform.googleapis.com/v1" if location == "global" else f"https://{location}-aiplatform.googleapis.com/v1"
    return (
        f"{base_url}/projects/{quote(project_id, safe='')}/locations/{quote(location, safe='')}/"
        f"publishers/google/models/{quote(model, safe='')}:predict"
    )


def vertex_embedding_model_id() -> str:
    model = str(
        os.getenv("VERTEX_EMBEDDING_MODEL")
        or os.getenv("GEMINI_EMBEDDING_MODEL")
        or os.getenv("EMBEDDING_MODEL")
        or "gemini-embedding-001"
    ).strip()
    for prefix in ("publishers/google/models/", "models/"):
        if model.startswith(prefix):
            return model[len(prefix) :]
    return model


def vertex_access_token() -> str:
    try:
        import google.auth
        from google.auth.transport.requests import Request
    except ImportError as exc:
        raise RuntimeError("google-auth is required when MOCK_EMBEDDINGS=false and EMBEDDING_PROVIDER=vertex.") from exc

    try:
        credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not getattr(credentials, "valid", False) or not getattr(credentials, "token", None):
            credentials.refresh(Request())
        token = getattr(credentials, "token", None)
        if not token:
            raise RuntimeError("Application Default Credentials did not return an access token.")
        return str(token)
    except Exception as exc:
        raise RuntimeError(f"Vertex ADC authentication failed: {exc}") from exc


def extract_vertex_embedding(payload: dict) -> list[float]:
    predictions = payload.get("predictions") or []
    if not predictions:
        raise RuntimeError("Vertex embeddings response did not include predictions.")

    first = predictions[0]
    if not isinstance(first, dict):
        raise RuntimeError("Vertex embeddings prediction had an unexpected shape.")

    embeddings = first.get("embeddings")
    if isinstance(embeddings, dict) and isinstance(embeddings.get("values"), list):
        return embeddings["values"]
    if isinstance(first.get("embedding"), list):
        return first["embedding"]
    if isinstance(first.get("values"), list):
        return first["values"]

    raise RuntimeError("Vertex embeddings response did not include embedding values.")


def embedding_provider() -> str:
    return (os.getenv("EMBEDDING_PROVIDER") or os.getenv("LLM_PROVIDER", "openai")).lower()


def embedding_model_name() -> str:
    if embedding_provider() == "vertex":
        return os.getenv("VERTEX_EMBEDDING_MODEL") or os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
    if embedding_provider() == "gemini":
        return os.getenv("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001")
    return os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")


def mock_llm_enabled() -> bool:
    return os.getenv("MOCK_LLM", "true").lower() in {"1", "true", "yes", "on"}


def mock_embeddings_enabled() -> bool:
    if "MOCK_EMBEDDINGS" in os.environ:
        return os.getenv("MOCK_EMBEDDINGS", "true").lower() in {"1", "true", "yes", "on"}
    return mock_llm_enabled()


def vector_literal(vector: list[float]) -> str:
    return "[" + ",".join(f"{value:.6f}" for value in vector) + "]"

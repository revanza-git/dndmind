# Deployment

DNDMind is designed to run locally with Docker Compose and to be straightforward to move to a small VPS.

## Local Docker Compose

Start all services:

```bash
docker compose up --build
```

Services:

- `postgres`: PostgreSQL 16 with pgvector and a persistent volume
- `ai-worker`: FastAPI worker on port `8001`
- `api`: ASP.NET Core API on port `8080`
- `web`: Next.js app on port `3000`

Stop services:

```bash
docker compose down
```

Reset local data:

```bash
docker compose down -v
docker compose up --build
```

## Environment Variables

Mock mode variables:

- `MOCK_LLM=true`
- `MOCK_EMBEDDINGS=true`
- `GEMINI_API_KEY=` and `OPENAI_API_KEY=` can stay empty

Core service variables:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_CONNECTION_STRING`
- `POSTGRES_DSN` or `DATABASE_URL`
- `AI_WORKER_URL`
- `NEXT_PUBLIC_API_BASE_URL` or `NEXT_PUBLIC_API_URL`

Provider variables for Gemini AI mode:

- `LLM_PROVIDER=gemini`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` or `CHAT_MODEL`
- `GEMINI_TEMPERATURE`
- `GEMINI_TIMEOUT_SECONDS`

Embedding provider variables if `MOCK_EMBEDDINGS=false`:

- `EMBEDDING_PROVIDER=gemini` or `openai`
- `GEMINI_EMBEDDING_MODEL`
- `GEMINI_EMBEDDING_DIMENSIONS=1536`
- `GEMINI_EMBEDDING_TIMEOUT_SECONDS`
- `OPENAI_API_KEY`
- `EMBEDDING_MODEL`

## Health Checks

- Frontend: `http://localhost:3000`
- API: `http://localhost:8080/api/health`
- Worker: `http://localhost:8001/health`
- Database: `docker compose exec postgres pg_isready -U dndmind -d dndmind`

## VPS Notes

A simple VPS deployment can use the same Compose file:

1. Install Docker and Docker Compose.
2. Copy the repository to the server.
3. Create a production `.env` with strong database credentials and any real provider keys.
4. Keep Postgres bound to the private Docker network unless remote DB access is required.
5. Put a reverse proxy in front of the `web` service.
6. Terminate TLS at the reverse proxy.
7. Route API traffic either through the frontend domain or a separate API subdomain.

Reverse proxy placeholder:

```text
https://dndmind.example.com  -> web:3000
https://api.dndmind.example.com -> api:8080
```

Kubernetes is intentionally unnecessary for this portfolio-scale deployment.

## Secrets

Never commit `.env` or real API keys. `.env.example` contains safe local defaults only.

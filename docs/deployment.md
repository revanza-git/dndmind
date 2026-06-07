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

Image generation variables:

- `IMAGE_GENERATION_ENABLED=false`
- `IMAGE_PROVIDER=mock`, `gemini`, or `vertex`
- `IMAGE_MODEL=gemini-2.5-flash-image`
- `IMAGE_ASPECT_RATIO=4:3` with supported values `1:1`, `3:4`, `4:3`, `9:16`, and `16:9`
- `IMAGE_TIMEOUT_SECONDS=60`

Provider variables for Vertex AI Gemini mode:

- `LLM_PROVIDER=vertex`
- `VERTEX_PROJECT_ID=project-de842900-cb0b-4155-b9c`
- `VERTEX_LOCATION=global`
- `VERTEX_MODEL=gemini-2.5-flash`
- `VERTEX_TEMPERATURE=0.7`
- `VERTEX_TIMEOUT_SECONDS=45`
- `GOOGLE_APPLICATION_CREDENTIALS` if the runtime needs an explicit ADC JSON path

For local Docker Compose with Vertex, Application Default Credentials must be available inside the `ai-worker` container. One common setup is to mount the local gcloud ADC file into the container and set `GOOGLE_APPLICATION_CREDENTIALS=/gcloud/application_default_credentials.json`. Keep `MOCK_EMBEDDINGS=true` for the first Vertex chat pass unless you are intentionally configuring a real embedding provider.

Real structured-card image generation is optional. Keep `IMAGE_GENERATION_ENABLED=false` for deterministic local placeholders. To turn it on, set `IMAGE_GENERATION_ENABLED=true` and choose `IMAGE_PROVIDER=gemini` with `GEMINI_API_KEY`, or `IMAGE_PROVIDER=vertex` with Vertex project, location, and ADC settings. Unsupported image aspect ratios fall back to `4:3`.

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

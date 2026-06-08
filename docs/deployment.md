# Deployment

DNDMind is mock-first locally and deploys cleanly to Google Cloud as three Cloud Run services backed by Cloud SQL for PostgreSQL with `pgvector`.

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

## Recommended GCP Shape

Use one GCP region for all runtime resources, for example `asia-southeast1`.

- Cloud Run service `dndmind-web`: public Next.js frontend.
- Cloud Run service `dndmind-api`: public API, or private behind a load balancer/API route.
- Cloud Run service `dndmind-ai-worker`: private worker. Grant only the API service account `roles/run.invoker`.
- Cloud SQL PostgreSQL 16: persistent app database with `pgvector`.
- Secret Manager: database password/connection strings and optional provider keys.
- Artifact Registry: Docker images tagged by commit SHA.
- Cloud Build or GitHub Actions: repeatable builds and deploys.

Launch with `MOCK_LLM=true`, `MOCK_EMBEDDINGS=true`, and `IMAGE_GENERATION_ENABLED=false`. Turn on real Gemini or Vertex AI only after the hosting path is healthy.

## Preflight Verification

Run these before building production images:

```bash
dotnet build apps/api/DNDMind.Api.csproj
cd apps/web
npm run build
cd ../ai-worker
python -m unittest discover -s tests
```

Or run the Docker Compose stack and confirm:

- Frontend: `http://localhost:3000`
- API: `http://localhost:8080/api/health`
- Worker: `http://localhost:8001/health`
- Database: `docker compose exec postgres pg_isready -U dndmind -d dndmind`

## GCP Bootstrap

Set local shell variables before running examples:

```bash
PROJECT_ID=your-gcp-project
REGION=asia-southeast1
REPOSITORY=dndmind
DB_INSTANCE=dndmind-postgres
DB_NAME=dndmind
DB_USER=dndmind
WEB_ORIGIN=https://dndmind.example.com
API_ORIGIN=https://api.dndmind.example.com
```

Enable required APIs:

```bash
gcloud services enable \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com
```

If using Vertex AI, also enable:

```bash
gcloud services enable aiplatform.googleapis.com
```

Create the Artifact Registry repository:

```bash
gcloud artifacts repositories create $REPOSITORY \
  --repository-format=docker \
  --location=$REGION
```

## Cloud SQL

Create PostgreSQL and keep deletion protection/backups enabled for production:

```bash
gcloud sql instances create $DB_INSTANCE \
  --database-version=POSTGRES_16 \
  --region=$REGION \
  --tier=db-custom-1-3840 \
  --storage-size=20GB \
  --storage-type=SSD \
  --backup-start-time=03:00 \
  --deletion-protection
```

Create the app database and user:

```bash
gcloud sql databases create $DB_NAME --instance=$DB_INSTANCE
gcloud sql users create $DB_USER --instance=$DB_INSTANCE --password=use-a-strong-password
```

Apply `db/init.sql` through a trusted SQL client or the Cloud SQL Auth Proxy. Confirm these extensions succeed:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

The current schema stores embeddings as `vector(1536)`. Keep `MOCK_EMBEDDINGS=true` for the first deployment, or ensure any real embedding provider is configured to return 1536 dimensions.

## Secrets

Store production secrets in Secret Manager, not in `.env` or build args.

Recommended secrets:

- `dndmind-postgres-connection-string`: API connection string.
- `dndmind-postgres-dsn`: worker PostgreSQL DSN.
- `dndmind-gemini-api-key`: only if using Gemini API-key chat, Gemini API-key embeddings, or Gemini API-key image generation.
- `dndmind-openai-api-key`: only if using OpenAI embeddings.

Example:

```bash
printf "Host=/cloudsql/$PROJECT_ID:$REGION:$DB_INSTANCE;Database=$DB_NAME;Username=$DB_USER;Password=..." \
  | gcloud secrets create dndmind-postgres-connection-string --data-file=-

printf "postgresql://$DB_USER:...@/$DB_NAME?host=/cloudsql/$PROJECT_ID:$REGION:$DB_INSTANCE" \
  | gcloud secrets create dndmind-postgres-dsn --data-file=-
```

Do not set `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run. Use service accounts attached to each service.

## Build Images

`cloudbuild.yaml` builds and pushes all three images with an explicit image tag. For the Cloud Run default-domain staging setup, build the web image with the same-origin Next.js proxy path:

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)

gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions _REGION=$REGION,_REPOSITORY=$REPOSITORY,_IMAGE_TAG=$IMAGE_TAG,_NEXT_PUBLIC_API_BASE_URL=/api/backend
```

Image names:

- `$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-web:$IMAGE_TAG`
- `$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-api:$IMAGE_TAG`
- `$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-ai-worker:$IMAGE_TAG`

Avoid deploying mutable `latest` tags to production.

## Service Accounts

Create separate runtime identities:

```bash
gcloud iam service-accounts create dndmind-api
gcloud iam service-accounts create dndmind-worker
gcloud iam service-accounts create dndmind-web
```

Grant the API and worker access to Cloud SQL and secrets they actually use:

```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:dndmind-api@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/cloudsql.client

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:dndmind-api@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:dndmind-worker@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/cloudsql.client

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member=serviceAccount:dndmind-worker@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

If using Vertex AI, grant the worker service account the minimum Vertex role required by your model calls.

## Deploy Cloud Run

Use the same `IMAGE_TAG` that you passed to Cloud Build.

Deploy the private worker:

```bash
gcloud run deploy dndmind-ai-worker \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-ai-worker:$IMAGE_TAG \
  --region=$REGION \
  --no-allow-unauthenticated \
  --port=8001 \
  --service-account=dndmind-worker@$PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:$DB_INSTANCE \
  --set-env-vars=MOCK_LLM=true,MOCK_EMBEDDINGS=true,IMAGE_GENERATION_ENABLED=false,LLM_PROVIDER=gemini,IMAGE_PROVIDER=mock \
  --set-secrets=POSTGRES_DSN=dndmind-postgres-dsn:latest,DATABASE_URL=dndmind-postgres-dsn:latest \
  --memory=1Gi \
  --cpu=1 \
  --max-instances=3
```

Capture the worker URL:

```bash
WORKER_URL=$(gcloud run services describe dndmind-ai-worker --region=$REGION --format='value(status.url)')
```

Deploy the API:

```bash
gcloud run deploy dndmind-api \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-api:$IMAGE_TAG \
  --region=$REGION \
  --allow-unauthenticated \
  --port=8080 \
  --service-account=dndmind-api@$PROJECT_ID.iam.gserviceaccount.com \
  --add-cloudsql-instances=$PROJECT_ID:$REGION:$DB_INSTANCE \
  --set-env-vars=ASPNETCORE_ENVIRONMENT=Production,ASPNETCORE_URLS=http://+:8080,AI_WORKER_URL=$WORKER_URL,AI_WORKER_AUTH_ENABLED=true,AI_WORKER_AUTH_AUDIENCE=$WORKER_URL,CORS_ALLOWED_ORIGINS=$WEB_ORIGIN \
  --set-secrets=ConnectionStrings__Postgres=dndmind-postgres-connection-string:latest \
  --memory=512Mi \
  --cpu=1 \
  --max-instances=5
```

Allow only the API service account to invoke the worker:

```bash
gcloud run services add-iam-policy-binding dndmind-ai-worker \
  --region=$REGION \
  --member=serviceAccount:dndmind-api@$PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/run.invoker
```

Deploy the web service:

```bash
gcloud run deploy dndmind-web \
  --image=$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/dndmind-web:$IMAGE_TAG \
  --region=$REGION \
  --allow-unauthenticated \
  --service-account=dndmind-web@$PROJECT_ID.iam.gserviceaccount.com \
  --set-env-vars=NODE_ENV=production,NEXT_TELEMETRY_DISABLED=1,API_PROXY_BASE_URL=$API_ORIGIN \
  --memory=512Mi \
  --cpu=1 \
  --max-instances=5
```

## Public Domain

For production, prefer a global external Application Load Balancer in front of Cloud Run:

- `/` routes to `dndmind-web`
- `/api/*` routes to `dndmind-api`

This lets you use one public origin and avoid cross-origin browser calls. If you use separate web/API domains, keep `CORS_ALLOWED_ORIGINS` set to the exact web origin.

Cloud Run direct domain mapping is simpler but currently less flexible than a load balancer for production use.

## Production Environment Variables

Mock-first runtime:

- `MOCK_LLM=true`
- `MOCK_EMBEDDINGS=true`
- `IMAGE_GENERATION_ENABLED=false`
- `IMAGE_PROVIDER=mock`

API:

- `ASPNETCORE_ENVIRONMENT=Production`
- `ConnectionStrings__Postgres` from Secret Manager
- `AI_WORKER_URL` set to the worker Cloud Run URL
- `AI_WORKER_AUTH_ENABLED=true` when the worker is private
- `AI_WORKER_AUTH_AUDIENCE` set to the worker Cloud Run URL
- `CORS_ALLOWED_ORIGINS=https://your-web-domain.example`

Worker:

- `POSTGRES_DSN` or `DATABASE_URL` from Secret Manager
- `LLM_PROVIDER=gemini` or `vertex`
- `EMBEDDING_PROVIDER=gemini`, `vertex`, or `openai` when `MOCK_EMBEDDINGS=false`
- `VERTEX_EMBEDDING_MODEL=gemini-embedding-001` and `VERTEX_EMBEDDING_DIMENSIONS=1536` when `EMBEDDING_PROVIDER=vertex`
- Provider keys only when mock mode is disabled
- No `GOOGLE_APPLICATION_CREDENTIALS` on Cloud Run

Web:

- `NEXT_PUBLIC_API_BASE_URL` is a build arg. Use `/api/backend` on Cloud Run to keep browser requests same-origin.
- `API_PROXY_BASE_URL` is a runtime env var set to the API service URL when using `/api/backend`.
- `NODE_ENV=production`
- `NEXT_TELEMETRY_DISABLED=1`

## Smoke Tests

After deploy:

```bash
curl "$API_ORIGIN/api/health"
curl "$WORKER_URL/health" -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences=$WORKER_URL)"
```

Then test the browser flow:

1. Open the web domain.
2. Load campaigns.
3. Send a chat message in mock mode.
4. Save a structured NPC or encounter card.
5. Upload a small `.md` or `.txt` rules document and ingest it.
6. Confirm Cloud Run logs show API-to-worker calls and no secret values.

## Rollback and Safety

- Keep Cloud Run revisions and deploy commit-tagged images.
- Use Cloud SQL automated backups before migrations or public testing.
- Set Cloud Run `--max-instances` to cap spend.
- Keep worker private.
- Restrict CORS in production.
- Treat `X-Dndmind-Client-Id` as demo scoping, not authentication. Add real auth before storing private user data.
- Do not commit `.env`, `.gcloud/`, ADC JSON, provider keys, or production database credentials.

## VPS Notes

A small VPS can still run the same Compose file behind a reverse proxy, but GCP production should prefer managed Cloud Run and Cloud SQL for simpler operations and safer public exposure.

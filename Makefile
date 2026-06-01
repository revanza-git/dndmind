.PHONY: up down logs reset-db test evals build health

up:
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

reset-db:
	docker compose down -v
	docker compose up --build

test:
	docker compose exec ai-worker python -m unittest discover -s tests

evals:
	@echo "Sample deterministic eval cases live in db/seed/eval_cases.json"
	@echo "Run the demo flow in README.md until an automated eval runner is added."

build:
	dotnet build apps/api/DNDMind.Api.csproj
	cd apps/web && npm run build

health:
	docker compose exec postgres pg_isready -U dndmind -d dndmind
	curl -f http://localhost:8080/api/health
	curl -f http://localhost:8001/health

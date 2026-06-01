# Phase 2 - Rules RAG Ingestion

Next Codex prompt:

```text
Implement Phase 2 for DNDMind: Rules RAG ingestion.

Add a document ingestion path for rules/homebrew markdown or text files:
- API endpoint to upload or register a rules document
- worker endpoint to chunk text into knowledge_chunks
- mock embedding mode that creates deterministic placeholder vectors
- real embedding adapter behind environment variables
- pgvector similarity search for /ai/search-rules
- citations in /ai/chat responses when context.useRules is true
- a small evaluation fixture with 5 rules questions

Keep MOCK_LLM=true and MOCK_EMBEDDINGS=true runnable without paid API calls.
Update README and Docker Compose environment variables.
```


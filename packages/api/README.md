# API Service

Backend API for SentinelRAG query pipeline.

## Architecture

**Query Pipeline:**
1. Query preprocessing
2. Hybrid retrieval (keyword + vector search)
3. Reranking (precision pass)
4. Answer synthesis (grounded LLM)
5. Evaluation + tracing

## Development

```bash
pnpm install
pnpm dev
```

## Environment Variables

See root `.env.example` for configuration.

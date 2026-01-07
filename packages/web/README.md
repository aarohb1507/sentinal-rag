# Web UI

Minimal, inspectable UI for SentinelRAG.

## Purpose

This UI is intentionally minimal and focused on **inspectability**, not aesthetics.

It exposes:
- Query input
- Answer with source attribution
- Retrieved chunks with scores
- Latency breakdown per pipeline stage
- Metadata (chunks retrieved/reranked/used)

## Development

```bash
pnpm install
pnpm dev
```

Visit http://localhost:3001

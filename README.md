# SentinelRAG

A production-grade Retrieval-Augmented Generation (RAG) system built from first principles to demonstrate deep understanding of RAG as a **system**, not prompt engineering.

## Design Philosophy

SentinelRAG is **not a chatbot demo**. It prioritizes:

- **Retrieval quality** over convenience
- **Answer faithfulness** over fluency
- **Debuggability** over black-box abstractions
- **Explicit failure handling** over silent errors
- **Infra-level correctness** over quick hacks

Every stage of the RAG pipeline is **explicit, inspectable, and evaluated**.

## Architecture

### Ingestion Pipeline

```
Documents → Custom Chunking → Embeddings → PostgreSQL (pgvector + tsvector) + Redis Cache
```

**Chunking strategies:**
- Fixed-size chunking (token-based with overlap)
- Semantic chunking (paragraph/section-aware)

Each chunk includes:
- Content + metadata
- Embedding vector (1536-dim)
- Keyword index (tsvector for BM25-style search)

### Query Pipeline

```
User Query → Preprocessing → Hybrid Retrieval → Reranking → Answer Synthesis → Evaluation
```

**1. Hybrid Retrieval (Mandatory)**
- Keyword search (PostgreSQL full-text)
- Vector search (pgvector cosine similarity)
- Results merged, deduplicated, scored

**2. Reranking (Mandatory)**
- Top ~30 chunks from hybrid retrieval
- LLM-based relevance scoring
- Top 5-8 chunks passed to synthesis
- **Why:** Reduces noise, improves precision, lowers hallucination rate

**3. Answer Synthesis (Strict)**
- LLM answers **only** using provided context
- Refuses to answer if context is insufficient
- Returns structured output: answer + source chunk IDs
- **No free-form guessing**

**4. Evaluation (First-Class Feature)**
- Context recall
- Answer faithfulness
- Answer relevance
- Per-stage latency tracking
- **Why:** RAG quality is measured, not assumed

## Tech Stack

**Monorepo (pnpm workspaces):**
- `packages/api` - Node.js + TypeScript (Fastify)
- `packages/worker` - Python (ingestion, embeddings, evaluation)
- `packages/web` - Next.js (minimal inspectable UI)
- `packages/shared` - Shared TypeScript types/utils

**Infrastructure:**
- PostgreSQL + pgvector (vector similarity)
- PostgreSQL tsvector (keyword search)
- Redis (embedding cache)
- Docker + Docker Compose
- Nginx (reverse proxy, rate limiting)

**No managed vector DBs. No magic frameworks hiding logic.**

## Why This Stack?

| Decision | Rationale |
|----------|-----------|
| **PostgreSQL + pgvector** | Single database for vector + keyword + ACID guarantees. No distributed consistency issues. |
| **tsvector (BM25-style)** | Keyword search built-in. No separate search engine. |
| **Hybrid retrieval** | Vector-only misses exact keyword matches. Keyword-only misses semantic similarity. Both are required. |
| **Mandatory reranking** | Initial retrieval is recall-focused (cast wide net). Reranking is precision-focused (remove noise). |
| **Strict answer synthesis** | Grounded answers > fluent hallucinations. Explicit refusal when context is insufficient. |
| **Redis cache** | Embeddings are expensive. Cache avoids redundant API calls. |
| **Custom chunking** | Fixed-size chunks break semantic meaning. Semantic chunking preserves context. |

## Setup

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker + Docker Compose
- pnpm (`npm install -g pnpm`)

### Quick Start

1. **Clone and install dependencies**

```bash
git clone <repo-url>
cd sentinal-rag
pnpm install
```

2. **Set up environment variables**

```bash
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY
```

3. **Start infrastructure (PostgreSQL + Redis)**

```bash
pnpm docker:up
```

This starts:
- PostgreSQL with pgvector on port 5432
- Redis on port 6379
- Initializes database schema automatically

4. **Start services**

**API (Terminal 1):**
```bash
cd packages/api
pnpm install
pnpm dev
```

**Worker (Terminal 2):**
```bash
cd packages/worker
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python src/main.py
```

**Web UI (Terminal 3):**
```bash
cd packages/web
pnpm install
pnpm dev
```

5. **Access the UI**

Open http://localhost:3001

## Project Structure

```
sentinal-rag/
├── packages/
│   ├── api/              # Node.js API (query pipeline)
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config.ts
│   │   │   ├── routes/
│   │   │   │   ├── health.ts
│   │   │   │   └── query.ts
│   │   │   └── utils/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   │
│   ├── worker/           # Python worker (ingestion, embeddings)
│   │   ├── src/
│   │   │   ├── main.py
│   │   │   ├── config.py
│   │   │   ├── chunking.py
│   │   │   └── ingestion.py
│   │   ├── requirements.txt
│   │   ├── pyproject.toml
│   │   └── Dockerfile
│   │
│   ├── web/              # Next.js UI (minimal, inspectable)
│   │   ├── src/app/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx
│   │   │   └── globals.css
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── Dockerfile
│   │
│   └── shared/           # Shared TypeScript types/utils
│       ├── src/
│       │   ├── types.ts
│       │   ├── constants.ts
│       │   └── utils.ts
│       └── package.json
│
├── infra/                # Infrastructure configs
│   ├── docker-compose.yml
│   ├── postgres-init/
│   │   └── 01-init.sql
│   └── nginx.conf
│
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

## API Endpoints

### API Service (port 3000)

- `GET /health` - Health check
- `POST /api/v1/query` - Submit RAG query

**Query Request:**
```json
{
  "query": "What is the capital of France?",
  "options": {
    "topK": 6,
    "includeDebug": true
  }
}
```

**Query Response:**
```json
{
  "requestId": "req_1234567890_abc123",
  "query": "What is the capital of France?",
  "answer": "Paris is the capital of France.",
  "sources": [
    {
      "chunkId": "chunk_123",
      "content": "Paris is the capital and largest city of France...",
      "score": 0.92,
      "metadata": { "section": "Geography" }
    }
  ],
  "metadata": {
    "latency": {
      "total": 1250,
      "retrieval": 180,
      "reranking": 420,
      "synthesis": 650
    },
    "chunksRetrieved": 28,
    "chunksReranked": 28,
    "chunksUsed": 6
  }
}
```

### Worker Service (port 8000)

- `GET /health` - Health check
- `POST /ingest` - Ingest document

**Ingest Request:**
```json
{
  "text": "Document content...",
  "metadata": {
    "title": "My Document",
    "source": "upload"
  },
  "chunking_strategy": "semantic"
}
```

## Database Schema

### `chunks` table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | SERIAL | Primary key |
| `content` | TEXT | Chunk text |
| `embedding` | vector(1536) | OpenAI embedding |
| `search_vector` | tsvector | Keyword search index |
| `metadata` | JSONB | Source, section, etc. |
| `chunk_type` | VARCHAR | 'fixed' or 'semantic' |
| `token_count` | INTEGER | Token count |

**Indices:**
- `ivfflat` on embedding (vector similarity)
- `GIN` on search_vector (keyword search)
- `GIN` on metadata (filtered search)

### `evaluation_runs` table

Stores metrics for every query:
- Context recall
- Answer faithfulness
- Answer relevance
- Latency breakdown
- Latency violations

## Design Decisions

### Why Hybrid Retrieval?

**Vector-only search fails on:**
- Exact keyword matches (acronyms, product names, IDs)
- Rare technical terms not well-represented in embedding space

**Keyword-only search fails on:**
- Semantic similarity (synonyms, paraphrases)
- Conceptual queries

**Hybrid search combines both strengths.**

### Why Reranking?

Initial retrieval is **recall-focused** (cast wide net, top 30 chunks).

Reranking is **precision-focused** (remove irrelevant chunks).

**Result:** Higher relevance, lower hallucination rate.

### Why Custom Chunking?

Fixed-size chunks (e.g., 512 tokens) **break semantic meaning**:
- Splits mid-sentence
- Loses paragraph context
- Fragments tables/lists

Semantic chunking **preserves meaning**:
- Respects paragraph boundaries
- Groups related sentences
- Maintains structural context

### Why Strict Answer Synthesis?

**Problem:** LLMs hallucinate when context is insufficient.

**Solution:** 
- Force LLM to answer **only from provided context**
- Explicit refusal when context is insufficient
- Return source chunk IDs for verification

**Trade-off:** Fewer answers, but all answers are grounded.

### Why Evaluation as a Feature?

**You can't improve what you don't measure.**

Every query is evaluated for:
- Context recall (did we retrieve the right chunks?)
- Answer faithfulness (did the LLM stick to the context?)
- Answer relevance (does the answer address the query?)

Metrics are stored and queryable for debugging and iteration.

## Latency Budgets

Each stage has an expected latency budget:

| Stage | Budget |
|-------|--------|
| Retrieval | 200ms |
| Reranking | 500ms |
| Synthesis | 3000ms |
| **Total** | **5000ms** |

Violations are logged and tracked in `evaluation_runs` table.

## Production Considerations

### What would change at scale?

**Current setup (works for ~100k chunks):**
- PostgreSQL + pgvector (single node)
- Redis (single node)
- Docker Compose

**At 10M+ chunks:**
- Sharded PostgreSQL or distributed vector DB (Weaviate, Qdrant)
- Redis Cluster for caching
- Separate reranking service (model server with GPU)
- Background ingestion queue (Celery, BullMQ)
- Kubernetes for orchestration
- Observability (Prometheus, Grafana, Jaeger)

**Cost optimization:**
- Cache query embeddings (not just chunk embeddings)
- Batch embedding generation
- Use smaller models for reranking (cross-encoder)
- Rate limit expensive operations

## Failure Modes & Mitigations

| Failure | Mitigation |
|---------|------------|
| Low retrieval recall | Improve chunking strategy, tune top-K |
| High retrieval noise | Improve reranking, adjust score thresholds |
| LLM hallucination | Strict prompting, enforce source attribution |
| Slow synthesis | Reduce context size, use faster model |
| Embedding API rate limit | Redis caching, exponential backoff |
| Database connection pool exhaustion | Connection pooling, health checks |

## Testing

**Unit tests:**
```bash
# API
cd packages/api
pnpm test

# Worker
cd packages/worker
pytest
```

**Integration tests:**
```bash
# Start all services
pnpm docker:up
pnpm dev

# Test ingestion
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{"text": "Test document", "chunking_strategy": "semantic"}'

# Test query
curl -X POST http://localhost:3000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"query": "test query"}'
```

## Contributing

This is a demonstration project showcasing RAG system design.

**Key principles:**
- Inspectability > abstraction
- Measurement > intuition
- Grounded answers > fluent answers
- Explicit failures > silent errors

## License

MIT

## Acknowledgments

Built to demonstrate production-grade RAG for AI Engineer / Backend / GenAI Infrastructure roles.

**Not a framework. Not a tutorial. A complete, working system.**

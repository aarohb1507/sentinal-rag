# SentinelRAG - Quick Start Guide

## Initial Setup (5 minutes)

### 1. Clone and Install Dependencies

```bash
cd /Users/z0diac/Desktop/sentinal-rag
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```bash
OPENAI_API_KEY=sk-...your-key-here
```

### 3. Start Infrastructure

```bash
pnpm docker:up
```

This starts:
- PostgreSQL + pgvector (port 5432)
- Redis (port 6379)
- Initializes database schema automatically

Verify services are running:
```bash
docker ps
```

## Development Mode

Open **3 terminals** and run:

**Terminal 1 - API Service:**
```bash
cd packages/api
pnpm install
pnpm dev
```
→ API running at http://localhost:3000

**Terminal 2 - Python Worker:**
```bash
cd packages/worker
python3 -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
python src/main.py
```
→ Worker running at http://localhost:8000

**Terminal 3 - Web UI:**
```bash
cd packages/web
pnpm install
pnpm dev
```
→ Web UI at http://localhost:3001

## Testing the System

### 1. Ingest a Document

```bash
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Paris is the capital and largest city of France. It is located in the north-central part of the country. The city is known for the Eiffel Tower, the Louvre Museum, and Notre-Dame Cathedral.",
    "metadata": {
      "title": "France Geography",
      "source": "test"
    },
    "chunking_strategy": "semantic"
  }'
```

### 2. Query via API

```bash
curl -X POST http://localhost:3000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{
    "query": "What is the capital of France?",
    "options": {
      "includeDebug": true
    }
  }'
```

### 3. Query via Web UI

Open http://localhost:3001 and enter: "What is the capital of France?"

## Project Structure

```
sentinal-rag/
├── packages/
│   ├── api/           # Node.js API (Fastify)
│   ├── worker/        # Python worker (ingestion)
│   ├── web/           # Next.js UI
│   └── shared/        # TypeScript types
├── infra/             # Docker configs
└── docs/              # Architecture docs
```

## Common Commands

```bash
# Install all dependencies
pnpm install

# Start infrastructure only
pnpm docker:up

# Stop infrastructure
pnpm docker:down

# View logs
pnpm docker:logs

# Clean all build artifacts
pnpm clean
```

## Database Access

Connect to PostgreSQL:
```bash
psql -h localhost -U postgres -d sentinelrag
# Password: postgres
```

Useful queries:
```sql
-- View all chunks
SELECT id, chunk_type, token_count, metadata FROM chunks;

-- View evaluation metrics
SELECT query, answer_faithfulness, latency_total FROM evaluation_runs;

-- Count chunks by type
SELECT chunk_type, COUNT(*) FROM chunks GROUP BY chunk_type;
```

## Troubleshooting

### Port already in use
```bash
# Find process using port
lsof -ti:3000  # or 3001, 5432, 6379, 8000
# Kill process
kill -9 <PID>
```

### PostgreSQL connection failed
```bash
# Restart Docker services
pnpm docker:down
pnpm docker:up
```

### OpenAI API errors
- Verify `OPENAI_API_KEY` in `.env`
- Check API quota at https://platform.openai.com/usage

### Python dependencies
```bash
# Recreate virtual environment
cd packages/worker
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Next Steps

1. ✅ Set up complete (you are here)
2. 📝 Ingest more documents
3. 🔍 Test hybrid retrieval
4. 📊 Implement reranking
5. 🤖 Wire up answer synthesis
6. 📈 Add evaluation metrics

See [README.md](../README.md) for architecture details.
See [docs/ADR.md](../docs/ADR.md) for design decisions.

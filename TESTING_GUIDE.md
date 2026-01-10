# Testing Guide - SentinelRAG

## System Status ✅

**All services are running and operational:**

- ✅ **PostgreSQL** (Docker): `localhost:5432` - Database with pgvector
- ✅ **Redis** (Docker): `localhost:6379` - Caching layer
- ✅ **Worker** (Docker): `localhost:8000` - Embedding + ingestion service
- ✅ **API** (Local): `localhost:3000` - Main backend service
- ✅ **Web UI** (Local): `localhost:3001` - Frontend interface

## Quick Start

### 1. Verify All Services

```bash
# Check Docker services
docker ps

# Should show:
# - sentinelrag-postgres (healthy)
# - sentinelrag-redis (healthy)
# - sentinelrag-worker (running)

# Check local services
# API terminal should show: "🚀 API server running at http://0.0.0.0:3000"
# Web terminal should show: "✓ Ready in XXXms"
```

### 2. Health Check

```bash
# API health check
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","timestamp":"...","services":{"redis":"connected","database":"connected","groq":"configured"}}
```

### 3. Test Embedding Service

```bash
# Test worker embedding endpoint
curl -X POST http://localhost:8000/embed \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello world"}'

# Expected: JSON with 384-dimension embedding vector
```

### 4. Ingest Sample Data

```bash
# Ingest a test document
curl -X POST http://localhost:8000/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Machine learning is a branch of artificial intelligence and computer science which focuses on the use of data and algorithms to imitate the way that humans learn, gradually improving its accuracy.",
    "metadata": {
      "source": "sample",
      "topic": "machine learning"
    },
    "document_id": "doc-001"
  }'

# Expected response:
# {
#   "status": "success",
#   "chunks_created": 1,
#   "total_tokens": 37,
#   "chunking_strategy": "semantic",
#   "document_id": "doc-001",
#   "cache_entries_invalidated": 1
# }
```

### 5. Test Query Pipeline (API)

```bash
# Query via API
curl -X POST http://localhost:3000/api/v1/query \
  -H "Content-Type: application/json" \
  -d '{"query": "What is machine learning?"}'

# Expected response structure:
# {
#   "requestId": "req-1",
#   "query": "What is machine learning?",
#   "answer": "Machine learning is...",
#   "sources": ["1"],
#   "metadata": {
#     "latency": {
#       "total": 750,
#       "embedding": 0,
#       "retrieval": 28,
#       "reranking": 493,
#       "synthesis": 228
#     },
#     "chunksRetrieved": 1,
#     "chunksReranked": 1,
#     "chunksUsed": 1
#   }
# }
```

### 6. Test Web UI

1. Open browser: http://localhost:3001
2. You should see the premium dark theme UI
3. Enter query: "What is machine learning?"
4. Click "Search" or press Enter
5. Verify:
   - ✅ Loading spinner appears
   - ✅ Answer section displays with green border
   - ✅ Metrics section shows timing breakdown (purple border)
   - ✅ Sources section lists chunk IDs
   - ✅ All text is readable on dark background

## Advanced Testing

### Database Verification

```bash
# Check ingested chunks
docker exec sentinelrag-postgres psql -U postgres -d sentinelrag -c "SELECT id, LEFT(content, 50), metadata FROM chunks;"

# Check vector dimensions
docker exec sentinelrag-postgres psql -U postgres -d sentinelrag -c "SELECT id, vector_dims(embedding) FROM chunks;"

# Should show: vector_dims = 384
```

### Redis Cache Verification

```bash
# Check cached embeddings
docker exec sentinelrag-redis redis-cli KEYS "embed:*"

# Check TTL on cached items
docker exec sentinelrag-redis redis-cli TTL "embed:some-hash"
```

### Performance Testing

```bash
# Test multiple queries in sequence
for i in {1..5}; do
  echo "Query $i"
  curl -s -X POST http://localhost:3000/api/v1/query \
    -H "Content-Type: application/json" \
    -d '{"query": "Explain deep learning"}' | jq '.metadata.latency.total'
  sleep 1
done

# Monitor latency - should be < 1000ms for cached embeddings
```

### Concurrent Load Test

```bash
# Install hey (HTTP load generator)
# macOS: brew install hey

# Run 100 requests with 10 concurrent connections
hey -n 100 -c 10 -m POST \
  -H "Content-Type: application/json" \
  -d '{"query": "What is AI?"}' \
  http://localhost:3000/api/v1/query

# Check latency p95, p99, error rate
```

## Testing Checklist

### System Components
- [ ] PostgreSQL container healthy
- [ ] Redis container healthy
- [ ] Worker container running
- [ ] API server responding (port 3000)
- [ ] Web UI loading (port 3001)

### API Endpoints
- [ ] `/health` returns 200 OK
- [ ] `/api/v1/query` accepts POST requests
- [ ] `/api/v1/query` returns valid JSON structure
- [ ] Groq API key is valid (check logs for auth errors)

### Worker Service
- [ ] `/embed` endpoint returns 384-dim vectors
- [ ] `/ingest` endpoint creates chunks successfully
- [ ] Embeddings are cached in Redis

### Database
- [ ] Chunks table exists
- [ ] Vector dimensions are 384 (not 1536)
- [ ] tsvector search_vector is populated
- [ ] Indexes exist (ivfflat, GIN)

### RAG Pipeline
- [ ] Embedding generation (< 100ms cached)
- [ ] Hybrid retrieval (keyword + vector)
- [ ] Reranking with Groq LLM
- [ ] Answer synthesis with context

### Web UI
- [ ] Dark theme CSS loaded correctly
- [ ] Query input field functional
- [ ] Submit button triggers API call
- [ ] Loading state displays
- [ ] Answer section renders with green border
- [ ] Metrics section shows timing breakdown
- [ ] Sources section lists chunk IDs
- [ ] Error handling (try invalid query)

## Troubleshooting

### API Returns "Retrieval service failed"
- Check database has data: `SELECT count(*) FROM chunks;`
- Verify vector dimensions: `SELECT vector_dims(embedding) FROM chunks LIMIT 1;`
- Check API logs for PostgreSQL errors

### API Returns "Synthesis service failed"
- Verify Groq API key in `.env`: `GROQ_API_KEY=gsk_...`
- Check Groq model is valid: `GROQ_MODEL=llama-3.3-70b-versatile`
- Test Groq API directly: `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`

### Web UI Shows "Failed to fetch"
- Verify API is running on port 3000
- Check browser console for CORS errors
- Ensure API has CORS enabled for localhost:3001

### Worker "/ingest" Returns 500 Error
- Check worker logs: `docker logs sentinelrag-worker`
- Verify pgvector extension: `docker exec sentinelrag-postgres psql -U postgres -d sentinelrag -c "CREATE EXTENSION IF NOT EXISTS vector;"`
- Restart worker: `docker-compose restart worker`

### Slow Query Performance (> 2s)
- Check if embeddings are cached (Redis)
- Verify database indexes exist
- Reduce `topK` parameters in config
- Check network latency to Groq API

## Configuration Reference

### Environment Variables (.env)

```bash
# Groq LLM
GROQ_API_KEY=gsk_...        # Your API key
GROQ_MODEL=llama-3.3-70b-versatile  # Current model (not mixtral)

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=sentinelrag
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Embeddings
EMBEDDINGS_MODEL=all-MiniLM-L6-v2
EMBEDDINGS_DIMENSION=384
WORKER_PORT=8000
```

### Key Metrics Targets

- **Total Latency**: < 1000ms (p95)
- **Retrieval**: < 50ms (hybrid search)
- **Reranking**: < 500ms (Groq LLM scoring)
- **Synthesis**: < 300ms (Groq answer generation)
- **Embedding (cached)**: < 5ms
- **Embedding (uncached)**: < 100ms

## Test Data

### Sample Documents for Ingestion

**AI/ML Domain:**
```json
{
  "text": "Deep learning is a subset of machine learning that uses neural networks with multiple layers. These networks can learn hierarchical representations of data, making them particularly effective for tasks like image recognition, natural language processing, and speech recognition.",
  "metadata": {"source": "docs", "topic": "deep learning"},
  "document_id": "doc-002"
}
```

**Technical Documentation:**
```json
{
  "text": "PostgreSQL is a powerful, open source object-relational database system with over 35 years of active development. It has earned a strong reputation for reliability, feature robustness, and performance.",
  "metadata": {"source": "docs", "topic": "databases"},
  "document_id": "doc-003"
}
```

**Programming Concepts:**
```json
{
  "text": "TypeScript is a strongly typed programming language that builds on JavaScript. It adds optional static typing to the language, which can help catch errors during development and improve code maintainability.",
  "metadata": {"source": "docs", "topic": "programming"},
  "document_id": "doc-004"
}
```

## Success Criteria

✅ **System is working correctly when:**

1. All 5 services are running (PostgreSQL, Redis, Worker, API, Web)
2. Health endpoint returns all services "connected"
3. Query through API returns answer in < 1000ms
4. Web UI displays answer with proper formatting
5. Metrics show reasonable latency breakdown
6. Sources are listed and traceable to chunks
7. Multiple queries work without errors
8. Embedding cache reduces latency on repeated queries

## Next Steps After Testing

Once all tests pass:

1. **Add More Data**: Ingest your actual documents via `/ingest` endpoint
2. **Monitor Performance**: Watch latency metrics in production queries
3. **Tune Parameters**: Adjust `topK`, reranker count based on quality/speed tradeoff
4. **Enable Docker Deployment**: Once stable, containerize API and Web for production
5. **Set Up Monitoring**: Add logging, metrics, and alerting
6. **Implement Authentication**: Secure the API endpoints
7. **Scale Services**: Use Docker Compose scaling or Kubernetes

---

**Last Updated**: January 10, 2026  
**System Version**: MVP 1.0  
**Tech Stack**: Node.js 20, Python 3.11, PostgreSQL 16, Redis 7, Groq LLM

# Architecture Decision Records (ADRs)

This document explains **why** specific design decisions were made in SentinelRAG.

## ADR-001: Why PostgreSQL + pgvector instead of dedicated vector DB?

**Context:**
Need to store vector embeddings for similarity search.

**Options:**
1. Dedicated vector DB (Pinecone, Weaviate, Qdrant)
2. PostgreSQL + pgvector extension

**Decision:** PostgreSQL + pgvector

**Rationale:**
- **Single database** for vector + keyword + metadata = no distributed consistency issues
- **ACID guarantees** for transactional workloads
- **Lower operational complexity** (no additional service to manage)
- **pgvector is production-ready** (used by Supabase, Timescale)
- **Cost-effective** for < 10M vectors

**Trade-offs:**
- Slower than specialized vector DBs at 100M+ scale
- Less sophisticated indexing options (ivfflat vs HNSW)

**When to reconsider:**
- > 10M vectors
- Requires millisecond-level vector search latency
- Need advanced indexing (HNSW, quantization)

---

## ADR-002: Why hybrid retrieval (keyword + vector)?

**Context:**
Need to retrieve relevant chunks for a given query.

**Options:**
1. Vector search only
2. Keyword search only
3. Hybrid (keyword + vector)

**Decision:** Hybrid (keyword + vector)

**Rationale:**

**Vector search fails on:**
- Exact matches (product IDs, acronyms, technical terms)
- Rare terms not well-represented in embedding space
- Queries where keyword precision matters

**Keyword search fails on:**
- Semantic similarity (synonyms, paraphrases)
- Conceptual queries ("How does X work?" vs "X mechanism")

**Hybrid search:**
- Combines strengths of both
- Deduplicates and ranks results
- Empirically shown to improve recall by 15-30% (citation: Pinecone hybrid search benchmarks)

**Implementation:**
- Run keyword (tsvector) and vector (pgvector) searches in parallel
- Merge results, deduplicate by chunk ID
- Keep highest score for duplicates
- Sort by score descending

---

## ADR-003: Why mandatory reranking?

**Context:**
Initial retrieval returns ~30 chunks. Not all are relevant.

**Options:**
1. Use top-K from retrieval directly
2. Add optional reranking step
3. Make reranking mandatory

**Decision:** Mandatory reranking

**Rationale:**

**Initial retrieval is recall-focused:**
- Cast wide net (top 30 chunks)
- May include tangentially related chunks
- Optimized for "don't miss anything important"

**Reranking is precision-focused:**
- LLM-based relevance scoring
- Cross-encoder-style evaluation (query + chunk → score)
- Removes noise before synthesis

**Impact on quality:**
- Reduces hallucination rate (less noise in context)
- Improves answer relevance (better chunk selection)
- Lower token cost (fewer chunks sent to synthesis)

**Trade-off:**
- Adds 300-500ms latency
- Additional LLM API cost

**Why mandatory:**
- Quality improvement is significant
- Cost is acceptable for production RAG

---

## ADR-004: Why strict answer synthesis (no guessing)?

**Context:**
LLM may generate plausible-sounding but incorrect answers.

**Options:**
1. Let LLM answer freely
2. Encourage grounding, but allow extrapolation
3. Strict grounding: answer only from context or refuse

**Decision:** Strict grounding with explicit refusal

**Rationale:**

**Problem:** LLM hallucinations erode trust in RAG systems.

**Solution:**
- System prompt: "Answer ONLY using provided context"
- Explicit instruction: "If context is insufficient, respond with 'Insufficient context to answer'"
- Structured output: `{ answer: string, sources: string[] }`

**Benefits:**
- **Higher faithfulness** (answers are verifiable)
- **Explicit failure mode** (user knows when system can't answer)
- **Debuggability** (can trace answer back to source chunks)

**Trade-off:**
- Fewer answered queries (strict system refuses more often)
- Less fluent answers (constrained to context)

**Why acceptable:**
- **Correctness > fluency** for production RAG
- Unanswered queries → improve ingestion/chunking
- Silent hallucinations → user loses trust

---

## ADR-005: Why custom chunking (not fixed-size only)?

**Context:**
Need to split documents into retrievable units.

**Options:**
1. Fixed-size chunks (512 tokens, 128 overlap)
2. Semantic chunking (paragraph/section-aware)
3. Both (configurable)

**Decision:** Both strategies, default to semantic

**Rationale:**

**Fixed-size chunking breaks meaning:**
```
Chunk 1: "...the capital of France is"
Chunk 2: "Paris. It is located in..."
```
Query: "What is the capital of France?"
→ Neither chunk contains the full answer.

**Semantic chunking preserves meaning:**
- Respects paragraph boundaries
- Groups related sentences
- Maintains context (headings, sections)

**Implementation:**
- Detect paragraph breaks (`\n\n`)
- Group paragraphs until max token limit
- Respect min/max chunk size boundaries

**Trade-off:**
- More complex than fixed-size
- Variable chunk sizes

**Why both:**
- Semantic chunking is better for quality
- Fixed-size is simpler for benchmarking

---

## ADR-006: Why evaluation as a first-class feature?

**Context:**
Need to measure RAG quality over time.

**Options:**
1. Manual testing only
2. Optional offline evaluation
3. Evaluation for every query (stored, queryable)

**Decision:** Evaluation for every query

**Rationale:**

**You can't improve what you don't measure.**

**Metrics tracked:**
- Context recall (did we retrieve the right chunks?)
- Answer faithfulness (did LLM stick to context?)
- Answer relevance (does answer address query?)
- Per-stage latency

**Why for every query:**
- Continuous quality monitoring
- Catch regressions early
- Debug individual failures
- A/B test chunking strategies

**Implementation:**
- Store evaluation results in `evaluation_runs` table
- Queryable by request ID, date range, metric thresholds
- Optional: run async to not block query response

**Trade-off:**
- Additional storage cost
- Evaluation latency (can run async)

**Why acceptable:**
- Quality visibility is critical for production RAG
- Debugging is 10x faster with metrics

---

## ADR-007: Why latency budgets?

**Context:**
RAG queries involve multiple stages (retrieval, reranking, synthesis).

**Options:**
1. No latency tracking
2. Track total latency only
3. Per-stage latency budgets

**Decision:** Per-stage latency budgets

**Rationale:**

**Total latency hides problems:**
- If total = 5s, is it retrieval (200ms) or synthesis (4.8s)?

**Per-stage budgets enable:**
- Identify bottlenecks (which stage is slow?)
- Set SLOs (retrieval < 200ms, reranking < 500ms)
- Prioritize optimizations (optimize slowest stage first)

**Budgets:**
- Retrieval: 200ms (database query)
- Reranking: 500ms (LLM scoring)
- Synthesis: 3000ms (LLM generation)
- Total: 5000ms

**Implementation:**
- Track start/end time for each stage
- Log violations to `evaluation_runs.latency_violations`
- Alert on repeated violations

**Why these budgets:**
- Based on typical latencies for each operation
- User-acceptable total latency (< 5s for Q&A)

---

## ADR-008: Why Redis for embedding cache?

**Context:**
OpenAI embeddings cost $0.0001 / 1K tokens. Repeated queries are expensive.

**Options:**
1. No caching
2. In-memory cache (per-process)
3. Redis (shared cache)

**Decision:** Redis (shared cache)

**Rationale:**

**Cost savings:**
- Same query repeated → use cached embedding
- Same chunk embedded multiple times (during testing) → cache

**Why Redis:**
- Shared across API + Worker instances
- Fast (< 1ms lookup)
- TTL support (expire old embeddings)

**Implementation:**
- Key: `embed:{hash(text)}`
- Value: JSON-serialized embedding vector
- TTL: 24 hours

**Trade-off:**
- Additional infrastructure dependency
- Cache invalidation complexity

**Why acceptable:**
- Cost savings > operational overhead
- Redis is lightweight and reliable

---

## ADR-009: Why minimal UI (not fancy)?

**Context:**
Need a UI for querying and inspecting results.

**Options:**
1. Feature-rich UI (animations, charts, dashboards)
2. Minimal inspectable UI

**Decision:** Minimal inspectable UI

**Rationale:**

**Goal: Demonstrate RAG system design, not frontend skills.**

**UI must expose:**
- Query input
- Answer + source attribution
- Retrieved chunks with scores
- Latency breakdown per stage
- Metadata (chunks retrieved/reranked/used)

**UI should NOT:**
- Be fancy or polished
- Hide how the system works
- Require significant frontend engineering

**Implementation:**
- Next.js (minimal setup)
- Plain CSS (no Tailwind/styled-components)
- Single page (no routing)

**Why this is correct:**
- For AI Engineer / Backend roles, UI is secondary
- Interviewers care about **system design**, not CSS
- Inspectability > aesthetics

---

## ADR-010: Why monorepo?

**Context:**
Project has multiple services (API, Worker, Web).

**Options:**
1. Separate repos (polyrepo)
2. Monorepo (pnpm workspaces)

**Decision:** Monorepo

**Rationale:**

**Benefits:**
- **Shared code** (`packages/shared` used by API + Web)
- **Atomic commits** (change API + Web in single commit)
- **Simplified setup** (single `pnpm install`)
- **Type safety across boundaries** (TypeScript project references)

**Trade-offs:**
- Slightly more complex setup
- Larger repo size

**Why acceptable:**
- Project is small enough for monorepo
- Benefits > complexity

---

## Summary

Every design decision in SentinelRAG is:
- **Explainable** (can defend in interview)
- **Measurable** (metrics prove it works)
- **Defensible** (trade-offs are explicit)

This is **not a tutorial**. It's a **production-grade RAG system** that signals senior-level thinking.

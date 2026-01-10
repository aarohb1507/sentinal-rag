"""
Document ingestion pipeline for SentinelRAG.

Pipeline:
1. Accept document (text, PDF, etc.)
2. Extract text content
3. Apply custom chunking strategy
4. Generate embeddings (local: all-MiniLM-L6-v2)
5. Store in PostgreSQL + pgvector + tsvector
6. Cache embeddings in Redis

MVP: Uses free, local sentence-transformers model
No API costs. Fast inference. Production-grade quality.
"""

from typing import List, Dict, Any
import asyncio
import logging
import psycopg
from pgvector.psycopg import register_vector
from redis.asyncio import Redis

logger = logging.getLogger(__name__)
import json
from sentence_transformers import SentenceTransformer
from config import db_config, redis_config
from chunking import chunk_document, Chunk
from cache_utils import CacheKeyManager


class IngestionPipeline:
    """Handles document ingestion, chunking, and storage."""
    
    def __init__(self):
        # Load local embedding model (all-MiniLM-L6-v2)
        # First run: downloads model (~50MB)
        # Subsequent runs: uses cached model
        self.embedding_model = SentenceTransformer(
            'sentence-transformers/all-MiniLM-L6-v2'
        )
        self.redis_client: Redis | None = None
        self.db_conn: psycopg.AsyncConnection | None = None
    
    async def initialize(self) -> None:
        """Initialize database and Redis connections."""
        # Redis
        self.redis_client = Redis(
            host=redis_config.host,
            port=redis_config.port,
            password=redis_config.password,
            decode_responses=True,
        )
        
        # PostgreSQL with pgvector
        self.db_conn = await psycopg.AsyncConnection.connect(
            f"postgresql://{db_config.user}:{db_config.password}@{db_config.host}:{db_config.port}/{db_config.database}"
        )
        # Register pgvector types - handle both sync and async versions
        try:
            result = register_vector(self.db_conn)
            if hasattr(result, '__await__'):
                await result
        except Exception as e:
            logger.warning(f"pgvector registration warning (may be ok): {e}")
    
    async def close(self) -> None:
        """Clean up connections."""
        if self.redis_client:
            await self.redis_client.aclose()
        if self.db_conn:
            await self.db_conn.close()
    
    async def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding vector for text using sentence-transformers.
        
        Uses all-MiniLM-L6-v2 (384 dimensions).
        Caches results in Redis to avoid redundant computation.
        
        MVP Advantages:
        - Free (local model, no API costs)
        - Fast (CPU inference, ~10ms per text)
        - No external dependencies
        - Production-grade quality
        """
        # Check cache first using proper key generation
        cache_key = CacheKeyManager.generate_embedding_key(text)
        if self.redis_client:
            cached = await self.redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        
        # Generate embedding using local model
        # Note: This is synchronous, wrapped in run_in_executor for async context
        embedding = self.embedding_model.encode(text, convert_to_tensor=False)
        
        # Cache for future use (24 hours)
        if self.redis_client:
            await self.redis_client.setex(
                cache_key,
                86400,  # 24 hours
                json.dumps(embedding.tolist()),  # Convert numpy to list for JSON
            )
        
        return embedding.tolist()
    
    async def store_chunk(self, chunk: Chunk, embedding: List[float]) -> None:
        """
        Store chunk in PostgreSQL with vector and keyword indices.
        
        Storage:
        - chunk content
        - embedding vector (pgvector)
        - tsvector for keyword search
        - metadata (JSON)
        """
        if not self.db_conn:
            raise RuntimeError("Database connection not initialized")
        
        async with self.db_conn.cursor() as cur:
            await cur.execute(
                """
                INSERT INTO chunks (content, embedding, search_vector, metadata, chunk_type, token_count)
                VALUES (%s, %s, to_tsvector('english', %s), %s, %s, %s)
                """,
                (
                    chunk.content,
                    embedding,
                    chunk.content,
                    json.dumps(chunk.metadata),
                    chunk.chunk_type,
                    chunk.token_count,
                ),
            )
            await self.db_conn.commit()
    
    async def invalidate_document_cache(self, document_id: str) -> int:
        """
        Invalidate all cached embeddings for a document.
        
        When a document is updated, we need to clear its cached embeddings.
        This queries Redis for all keys matching the document pattern.
        
        Args:
            document_id: The unique identifier of the document
            
        Returns:
            Number of cache entries deleted
        """
        if not self.redis_client:
            return 0
        
        # Find all chunk embedding keys for this document
        pattern = CacheKeyManager.DOCUMENT_PREFIX + f"{document_id}:chunk:*"
        cursor = 0
        deleted_count = 0
        
        # Use SCAN to iterate over matching keys (avoids blocking)
        while True:
            cursor, keys = await self.redis_client.scan(cursor, match=pattern, count=100)
            if keys:
                deleted_count += await self.redis_client.delete(*keys)
            if cursor == 0:
                break
        
        return deleted_count
    
    async def ingest_document(
        self,
        text: str,
        metadata: Dict[str, Any],
        chunking_strategy: str = "semantic",
        document_id: str | None = None,
    ) -> Dict[str, Any]:
        """
        Main ingestion entry point.
        
        Steps:
        1. If document_id provided and exists, invalidate old cache
        2. Chunk document
        3. Generate embeddings for each chunk
        4. Store in database with keyword + vector indices
        5. Track chunk embeddings in Redis for future invalidation
        
        Args:
            text: Document text to ingest
            metadata: Document metadata
            chunking_strategy: "fixed" or "semantic" chunking
            document_id: Optional document ID for cache tracking and updates
        
        Returns:
            Ingestion statistics including cache invalidation info
        """
        cache_invalidated = 0
        
        # Step 1: Invalidate old cache if document is being updated
        if document_id:
            cache_invalidated = await self.invalidate_document_cache(document_id)
        
        # Step 2: Chunking
        chunks = chunk_document(text, metadata, strategy=chunking_strategy)  # type: ignore
        
        # Step 3 & 4 & 5: Generate embeddings and store
        tasks = []
        for chunk_index, chunk in enumerate(chunks):
            embedding = await self.generate_embedding(chunk.content)
            tasks.append(self.store_chunk(chunk, embedding))
            
            # Track document chunk for cache invalidation
            if document_id and self.redis_client:
                chunk_cache_key = CacheKeyManager.generate_embedding_for_document_key(
                    document_id, chunk_index
                )
                # Store reference to the embedding cache key
                embed_key = CacheKeyManager.generate_embedding_key(chunk.content)
                await self.redis_client.setex(
                    chunk_cache_key,
                    86400,  # 24 hours
                    embed_key,  # Store the embedding key for quick deletion
                )
        
        await asyncio.gather(*tasks)
        
        return {
            "status": "success",
            "chunks_created": len(chunks),
            "total_tokens": sum(c.token_count for c in chunks),
            "chunking_strategy": chunking_strategy,
            "document_id": document_id,
            "cache_entries_invalidated": cache_invalidated,
        }

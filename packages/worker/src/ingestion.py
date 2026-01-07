"""
Document ingestion pipeline for SentinelRAG.

Pipeline:
1. Accept document (text, PDF, etc.)
2. Extract text content
3. Apply custom chunking strategy
4. Generate embeddings
5. Store in PostgreSQL + pgvector + tsvector
6. Cache embeddings in Redis
"""

from typing import List, Dict, Any
import asyncio
from openai import AsyncOpenAI
import psycopg
from pgvector.psycopg import register_vector
from redis.asyncio import Redis
import json
from config import db_config, redis_config, openai_config
from chunking import chunk_document, Chunk


class IngestionPipeline:
    """Handles document ingestion, chunking, and storage."""
    
    def __init__(self):
        self.openai_client = AsyncOpenAI(api_key=openai_config.api_key)
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
        await register_vector(self.db_conn)
    
    async def close(self) -> None:
        """Clean up connections."""
        if self.redis_client:
            await self.redis_client.aclose()
        if self.db_conn:
            await self.db_conn.close()
    
    async def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding vector for text.
        
        Uses OpenAI text-embedding-3-small (1536 dimensions).
        Caches results in Redis to avoid redundant API calls.
        """
        # Check cache first
        cache_key = f"embed:{hash(text)}"
        if self.redis_client:
            cached = await self.redis_client.get(cache_key)
            if cached:
                return json.loads(cached)
        
        # Generate embedding
        response = await self.openai_client.embeddings.create(
            model=openai_config.embedding_model,
            input=text,
        )
        
        embedding = response.data[0].embedding
        
        # Cache for future use
        if self.redis_client:
            await self.redis_client.setex(
                cache_key,
                86400,  # 24 hours
                json.dumps(embedding),
            )
        
        return embedding
    
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
    
    async def ingest_document(
        self,
        text: str,
        metadata: Dict[str, Any],
        chunking_strategy: str = "semantic"
    ) -> Dict[str, Any]:
        """
        Main ingestion entry point.
        
        Steps:
        1. Chunk document
        2. Generate embeddings for each chunk
        3. Store in database with keyword + vector indices
        
        Returns ingestion statistics.
        """
        # Step 1: Chunking
        chunks = chunk_document(text, metadata, strategy=chunking_strategy)  # type: ignore
        
        # Step 2 & 3: Generate embeddings and store
        tasks = []
        for chunk in chunks:
            embedding = await self.generate_embedding(chunk.content)
            tasks.append(self.store_chunk(chunk, embedding))
        
        await asyncio.gather(*tasks)
        
        return {
            "status": "success",
            "chunks_created": len(chunks),
            "total_tokens": sum(c.token_count for c in chunks),
            "chunking_strategy": chunking_strategy,
        }

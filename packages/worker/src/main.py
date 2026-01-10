"""
FastAPI service for worker endpoints.
Handles document ingestion and background jobs.
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Literal
from contextlib import asynccontextmanager
from ingestion import IngestionPipeline
from config import worker_config
import logging

logging.basicConfig(
    level=getattr(logging, worker_config.log_level),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Global pipeline instance
pipeline: IngestionPipeline | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize and cleanup resources."""
    global pipeline
    pipeline = IngestionPipeline()
    await pipeline.initialize()
    logger.info("✅ Worker service initialized")
    yield
    if pipeline:
        await pipeline.close()
    logger.info("🛑 Worker service shutdown")


app = FastAPI(
    title="SentinelRAG Worker",
    description="Document ingestion, embeddings, and evaluation service",
    version="0.1.0",
    lifespan=lifespan,
)


class IngestRequest(BaseModel):
    """Request model for document ingestion."""
    
    text: str
    metadata: Dict[str, Any] = {}
    chunking_strategy: Literal["fixed", "semantic"] = "semantic"
    document_id: str | None = None  # For tracking and cache invalidation


class HealthResponse(BaseModel):
    """Health check response."""
    
    status: str
    service: str
    version: str


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="ok",
        service="sentinal-rag-worker",
        version="0.1.0",
    )


@app.get("/cache/stats")
async def get_cache_stats():
    """
    Get cache statistics for monitoring.
    
    Returns:
    - Total embedding cache keys
    - Total cache size in bytes
    """
    if not pipeline or not pipeline.redis_client:
        raise HTTPException(status_code=503, detail="Cache not initialized")
    
    try:
        from cache_utils import CacheKeyManager
        
        cursor = 0
        total_keys = 0
        total_size = 0
        
        pattern = f"{CacheKeyManager.EMBEDDING_PREFIX}*"
        while True:
            cursor, keys = await pipeline.redis_client.scan(
                cursor, match=pattern, count=100
            )
            total_keys += len(keys)
            for key in keys:
                size = await pipeline.redis_client.memory_usage(key)
                if size:
                    total_size += size
            if cursor == 0:
                break
        
        return {
            "status": "ok",
            "total_embedding_cache_keys": total_keys,
            "total_cache_size_bytes": total_size,
        }
    except Exception as e:
        logger.error(f"Failed to get cache stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ingest")
async def ingest_document(request: IngestRequest):
    """
    Ingest a document into the RAG system.
    
    Pipeline:
    1. If document_id provided and exists, invalidate old cache
    2. Chunk document (fixed or semantic)
    3. Generate embeddings
    4. Store in PostgreSQL + pgvector + tsvector
    5. Cache embeddings in Redis
    
    Returns ingestion statistics with cache invalidation info.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        result = await pipeline.ingest_document(
            text=request.text,
            metadata=request.metadata,
            chunking_strategy=request.chunking_strategy,
            document_id=request.document_id,  # Pass document_id for cache tracking
        )
        return result
    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=worker_config.host,
        port=worker_config.port,
        reload=worker_config.env == "development",
    )

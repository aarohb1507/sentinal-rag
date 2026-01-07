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


@app.post("/ingest")
async def ingest_document(request: IngestRequest):
    """
    Ingest a document into the RAG system.
    
    Pipeline:
    1. Chunk document (fixed or semantic)
    2. Generate embeddings
    3. Store in PostgreSQL + pgvector + tsvector
    4. Cache embeddings in Redis
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        result = await pipeline.ingest_document(
            text=request.text,
            metadata=request.metadata,
            chunking_strategy=request.chunking_strategy,
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

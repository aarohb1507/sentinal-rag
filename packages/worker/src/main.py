"""
FastAPI service for worker endpoints.
Handles document ingestion and background jobs.
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Any, Literal, Optional
from contextlib import asynccontextmanager
from ingestion import IngestionPipeline
from config import worker_config
import logging
import json
from pypdf import PdfReader
import io

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

# Configure CORS origins based on environment
cors_origins = [
    "http://localhost:3001",  # Web UI (dev)
    "http://localhost:3000",  # API (dev)
]

# Add Cloud Run origins in production
if worker_config.env == "production":
    cors_origins.extend([
        "https://sentinal-api-711220270423.asia-south1.run.app",
        "https://sentinal-web-711220270423.asia-south1.run.app",
    ])

# Add CORS middleware to allow requests from Web UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class IngestRequest(BaseModel):
    """Request model for document ingestion."""
    
    text: str
    metadata: Dict[str, Any] = {}
    chunking_strategy: Literal["fixed", "semantic"] = "semantic"
    document_id: str | None = None


class EmbedRequest(BaseModel):
    """Request model for embedding generation."""
    
    text: str
    model: str = "all-MiniLM-L6-v2"  # For API to specify model


class EmbeddingResponse(BaseModel):
    """Response model for embeddings."""
    
    embedding: list
    model: str
    dimension: int


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


@app.post("/admin/reset-schema")
async def reset_schema():
    """
    ADMIN ONLY: Drop and recreate database tables.
    WARNING: This deletes all data!
    """
    if not pipeline or not pipeline.db_conn:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        async with pipeline.db_conn.cursor() as cur:
            # Drop existing tables
            await cur.execute("DROP TABLE IF EXISTS chunks CASCADE")
            await cur.execute("DROP TABLE IF EXISTS documents CASCADE")
            logger.info("Dropped existing tables")
            
            # Recreate with correct schema
            await cur.execute("""
                CREATE TABLE documents (
                    id TEXT PRIMARY KEY,
                    filename TEXT,
                    file_type TEXT,
                    total_pages INTEGER,
                    total_chunks INTEGER,
                    metadata JSONB,
                    status TEXT DEFAULT 'active',
                    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
                )
            """)
            logger.info("Created documents table")
            
            await cur.execute("""
                CREATE TABLE chunks (
                    id SERIAL PRIMARY KEY,
                    content TEXT,
                    embedding vector(384),
                    search_vector tsvector,
                    metadata JSONB,
                    chunk_type TEXT,
                    token_count INTEGER,
                    document_id TEXT REFERENCES documents(id) ON DELETE CASCADE
                )
            """)
            logger.info("Created chunks table")
            
            # Create indices
            await cur.execute("""
                CREATE INDEX chunks_embedding_idx ON chunks 
                USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100)
            """)
            await cur.execute("CREATE INDEX chunks_search_idx ON chunks USING GIN (search_vector)")
            await cur.execute("CREATE INDEX chunks_document_id_idx ON chunks (document_id)")
            await cur.execute("CREATE INDEX documents_status_idx ON documents (status)")
            logger.info("Created indices")
            
            await pipeline.db_conn.commit()
        
        return {
            "status": "success",
            "message": "Schema reset complete",
            "tables_created": ["documents", "chunks"]
        }
    except Exception as e:
        logger.error(f"Schema reset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Document Management Endpoints ====================

@app.get("/documents")
async def list_documents():
    """
    List all uploaded documents.
    
    Returns list of documents with metadata, chunk counts, and upload dates.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        documents = await pipeline.list_documents()
        return {
            "status": "ok",
            "documents": documents,
            "total": len(documents),
        }
    except Exception as e:
        logger.error(f"Failed to list documents: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """
    Delete a document and all its chunks.
    
    Also invalidates any cached embeddings for this document.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        result = await pipeline.delete_document(document_id)
        if not result["document_deleted"]:
            raise HTTPException(status_code=404, detail="Document not found")
        return {
            "status": "success",
            "message": f"Document '{document_id}' deleted",
            **result,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete document: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Cache Endpoints ====================

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


@app.post("/ingest-pdf")
async def ingest_pdf(
    file: UploadFile = File(...),
    metadata: Optional[str] = Form("{}"),
    chunking_strategy: str = Form("semantic"),
    document_id: Optional[str] = Form(None)
):
    """
    Ingest a PDF document into the RAG system.
    
    Pipeline:
    1. Extract text from PDF (all pages)
    2. Chunk document (fixed or semantic)
    3. Generate embeddings
    4. Store in PostgreSQL + pgvector + tsvector
    5. Cache embeddings in Redis
    
    Returns ingestion statistics.
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    # Validate file type
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        # Parse metadata JSON
        metadata_dict = json.loads(metadata) if metadata else {}
        
        # Read PDF file
        pdf_bytes = await file.read()
        pdf_file = io.BytesIO(pdf_bytes)
        
        # Extract text from PDF
        reader = PdfReader(pdf_file)
        text_parts = []
        
        for page_num, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text()
            if page_text.strip():
                text_parts.append(page_text)
        
        if not text_parts:
            raise HTTPException(status_code=400, detail="No text found in PDF")
        
        # Combine all pages
        full_text = "\n\n".join(text_parts)
        
        # Add PDF metadata
        metadata_dict["source_file"] = file.filename
        metadata_dict["total_pages"] = len(reader.pages)
        metadata_dict["file_type"] = "pdf"
        
        # Use document_id from form or generate from filename
        doc_id = document_id or f"pdf-{file.filename}"
        
        # Ingest the extracted text
        result = await pipeline.ingest_document(
            text=full_text,
            metadata=metadata_dict,
            chunking_strategy=chunking_strategy,  # type: ignore
            document_id=doc_id,
        )
        
        return result
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid metadata JSON")
    except Exception as e:
        logger.error(f"PDF ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/embed", response_model=EmbeddingResponse)
async def embed_text(request: EmbedRequest):
    """
    Generate embedding for a text using sentence-transformers (all-MiniLM-L6-v2).
    
    This endpoint is called by the API service for query embeddings.
    Results are cached to avoid redundant computation.
    
    Returns:
    - embedding: vector of 384 dimensions
    - model: embedding model used
    - dimension: output dimension
    
    MVP Embedding Strategy:
    - Local: all-MiniLM-L6-v2 (no API costs)
    - Fast: CPU inference ~10ms per text
    - Free-tier friendly
    - Same model used in document ingestion (CRITICAL for consistency)
    """
    if not pipeline:
        raise HTTPException(status_code=503, detail="Pipeline not initialized")
    
    try:
        embedding = await pipeline.generate_embedding(request.text)
        return EmbeddingResponse(
            embedding=embedding,
            model="all-MiniLM-L6-v2",
            dimension=384,
        )
    except Exception as e:
        logger.error(f"Embedding failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=worker_config.host,
        port=worker_config.get_port(),
        reload=worker_config.env == "development",
    )

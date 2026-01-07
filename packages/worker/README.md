# Worker Service

Python service for document ingestion, embeddings generation, and RAG evaluation.

## Components

- **Chunking**: Custom strategies (fixed-size + semantic)
- **Embeddings**: OpenAI text-embedding-3-small with Redis caching
- **Storage**: PostgreSQL + pgvector + tsvector (keyword search)
- **Evaluation**: RAGAS-based metrics (TODO)

## Development

```bash
python -m venv venv
source venv/bin/activate  # or `venv\Scripts\activate` on Windows
pip install -r requirements.txt
python src/main.py
```

## API Endpoints

- `POST /ingest` - Ingest document
- `GET /health` - Health check

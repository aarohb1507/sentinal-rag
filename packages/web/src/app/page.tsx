'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './page.module.css';

interface Document {
  id: string;
  filename: string;
  file_type: string;
  total_pages: number;
  total_chunks: number;
  status: string;
  created_at: string;
}

interface QueryResponse {
  requestId: string;
  query: string;
  answer: string;
  sources: Array<{
    chunkId: string;
    content: string;
    score: number;
    metadata: Record<string, any>;
  }>;
  metadata: {
    latency: {
      total: number;
      retrieval: number;
      reranking: number;
      synthesis: number;
    };
    chunksRetrieved: number;
    chunksReranked: number;
    chunksUsed: number;
  };
}

// Worker URL for direct access (PDF upload, documents)
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || 'http://localhost:8000';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // PDF upload state
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  
  // Document management state
  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>('');
  const [deleteLoading, setDeleteLoading] = useState<string | null>(null);

  // Fetch documents on mount and after changes
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${WORKER_URL}/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents || []);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/v1/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          options: {
            includeDebug: true,
            documentId: selectedDocumentId || undefined, // Filter by selected document
          },
        }),
      });

      if (!res.ok) {
        throw new Error(`Query failed: ${res.statusText}`);
      }

      const data = await res.json();
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are supported');
      return;
    }

    setUploadLoading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('metadata', JSON.stringify({
        uploaded_at: new Date().toISOString(),
        original_filename: file.name,
      }));
      formData.append('chunking_strategy', 'semantic');

      const res = await fetch(`${WORKER_URL}/ingest-pdf`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || 'Upload failed');
      }

      const data = await res.json();
      setUploadSuccess(`✅ Successfully ingested: ${data.chunks_created} chunks created from "${file.name}"`);
      
      // Refresh documents list
      await fetchDocuments();
      
      // Reset file input
      e.target.value = '';
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
    }
  };

  const handleDeleteDocument = async (documentId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"? This will remove all its chunks.`)) {
      return;
    }

    setDeleteLoading(documentId);
    
    try {
      const res = await fetch(`${WORKER_URL}/documents/${encodeURIComponent(documentId)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        throw new Error('Failed to delete document');
      }

      // If deleted document was selected, clear selection
      if (selectedDocumentId === documentId) {
        setSelectedDocumentId('');
      }

      // Refresh documents list
      await fetchDocuments();
    } catch (err) {
      console.error('Failed to delete document:', err);
      alert('Failed to delete document. Please try again.');
    } finally {
      setDeleteLoading(null);
    }
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>SentinelRAG</h1>
          <p>Production-grade RAG with inspectable retrieval</p>
        </header>

        {/* PDF Upload Section */}
        <section className={styles.uploadSection}>
          <h2>📄 Upload PDF Document</h2>
          <div className={styles.uploadContainer}>
            <label htmlFor="pdf-upload" className={styles.uploadButton}>
              {uploadLoading ? 'Uploading...' : 'Choose PDF File'}
            </label>
            <input
              id="pdf-upload"
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={uploadLoading}
              className={styles.fileInput}
            />
          </div>
          {uploadSuccess && (
            <div className={styles.uploadSuccess}>{uploadSuccess}</div>
          )}
          {uploadError && (
            <div className={styles.uploadError}>{uploadError}</div>
          )}
        </section>

        {/* Documents List Section */}
        <section className={styles.documentsSection}>
          <h2>📚 Your Documents</h2>
          {documentsLoading ? (
            <p className={styles.documentsLoading}>Loading documents...</p>
          ) : documents.length === 0 ? (
            <p className={styles.documentsEmpty}>No documents uploaded yet. Upload a PDF to get started!</p>
          ) : (
            <>
              <div className={styles.documentsList}>
                {documents.map((doc) => (
                  <div 
                    key={doc.id} 
                    className={`${styles.documentItem} ${selectedDocumentId === doc.id ? styles.documentItemSelected : ''}`}
                  >
                    <div 
                      className={styles.documentInfo}
                      onClick={() => setSelectedDocumentId(selectedDocumentId === doc.id ? '' : doc.id)}
                    >
                      <input
                        type="radio"
                        name="selectedDoc"
                        checked={selectedDocumentId === doc.id}
                        onChange={() => setSelectedDocumentId(selectedDocumentId === doc.id ? '' : doc.id)}
                        className={styles.documentRadio}
                      />
                      <div className={styles.documentDetails}>
                        <span className={styles.documentName}>{doc.filename}</span>
                        <span className={styles.documentMeta}>
                          {doc.total_chunks} chunks • {doc.total_pages} page{doc.total_pages !== 1 ? 's' : ''} • {new Date(doc.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <button
                      className={styles.deleteButton}
                      onClick={() => handleDeleteDocument(doc.id, doc.filename)}
                      disabled={deleteLoading === doc.id}
                      title="Delete document"
                    >
                      {deleteLoading === doc.id ? '...' : '🗑️'}
                    </button>
                  </div>
                ))}
              </div>
              <p className={styles.contextHint}>
                {selectedDocumentId 
                  ? `🔍 Searching in: "${documents.find(d => d.id === selectedDocumentId)?.filename}"`
                  : '🔍 Searching in: All documents'}
              </p>
            </>
          )}
        </section>

        {/* Query Form */}
        <form onSubmit={handleSubmit} className={styles.queryForm}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask a question..."
            className={styles.input}
            disabled={loading}
          />
          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </form>

        {error && (
          <div className={styles.error}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {response && (
          <div className={styles.results}>
            <section className={styles.answer}>
              <h2>Answer</h2>
              <p>{response.answer}</p>
              <div className={styles.requestId}>Request ID: {response.requestId}</div>
            </section>

            <section className={styles.metrics}>
              <h2>Performance Metrics</h2>
              <div className={styles.metricsGrid}>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Total Latency</span>
                  <span className={styles.metricValue}>{response.metadata.latency.total}ms</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Retrieval</span>
                  <span className={styles.metricValue}>{response.metadata.latency.retrieval}ms</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Reranking</span>
                  <span className={styles.metricValue}>{response.metadata.latency.reranking}ms</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Synthesis</span>
                  <span className={styles.metricValue}>{response.metadata.latency.synthesis}ms</span>
                </div>
              </div>
              <div className={styles.metricsGrid}>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Chunks Retrieved</span>
                  <span className={styles.metricValue}>{response.metadata.chunksRetrieved}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Chunks Reranked</span>
                  <span className={styles.metricValue}>{response.metadata.chunksReranked}</span>
                </div>
                <div className={styles.metric}>
                  <span className={styles.metricLabel}>Chunks Used</span>
                  <span className={styles.metricValue}>{response.metadata.chunksUsed}</span>
                </div>
              </div>
            </section>

            {response.sources.length > 0 && (
              <section className={styles.sources}>
                <h2>Source Chunks ({response.sources.length})</h2>
                {response.sources.map((source, idx) => (
                  <div key={source.chunkId} className={styles.source}>
                    <div className={styles.sourceHeader}>
                      <span className={styles.sourceRank}>#{idx + 1}</span>
                      <span className={styles.sourceScore}>Score: {source.score.toFixed(3)}</span>
                    </div>
                    <p className={styles.sourceContent}>{source.content}</p>
                    <div className={styles.sourceMetadata}>
                      {Object.entries(source.metadata).map(([key, value]) => (
                        <span key={key} className={styles.metadataTag}>
                          {key}: {JSON.stringify(value)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

'use client';

import { useState } from 'react';
import styles from './page.module.css';

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

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v1/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          options: {
            includeDebug: true,
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

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>SentinelRAG</h1>
          <p>Production-grade RAG with inspectable retrieval</p>
        </header>

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

# Shared Package

Shared TypeScript types, constants, and utilities for SentinelRAG.

## Contents

- **types.ts**: Core interfaces (Chunk, Document, QueryRequest, QueryResponse, etc.)
- **constants.ts**: System-wide constants (latency budgets, RAG config)
- **utils.ts**: Shared utilities (request ID generation, latency checking, result merging)

## Usage

```typescript
import { QueryRequest, RAG_CONFIG, generateRequestId } from '@sentinal-rag/shared';
```

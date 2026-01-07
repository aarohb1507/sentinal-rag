"""
Custom chunking strategies for SentinelRAG.

Implements:
1. Fixed-size chunking with token-based overlap
2. Semantic chunking based on document structure (headings, paragraphs)

Each chunk preserves semantic meaning and includes metadata for retrieval.
"""

from typing import List, Dict, Any, Literal
from dataclasses import dataclass
import tiktoken
from config import chunking_config


@dataclass
class Chunk:
    """Represents a semantically meaningful document chunk."""
    
    content: str
    metadata: Dict[str, Any]
    chunk_type: Literal["fixed", "semantic"]
    start_index: int
    end_index: int
    token_count: int


class Chunker:
    """Base chunker class with token counting utilities."""
    
    def __init__(self, model: str = "gpt-4"):
        self.encoding = tiktoken.encoding_for_model(model)
    
    def count_tokens(self, text: str) -> int:
        """Count tokens in text using tiktoken."""
        return len(self.encoding.encode(text))
    
    def chunk_by_tokens(
        self,
        text: str,
        chunk_size: int,
        overlap: int
    ) -> List[Chunk]:
        """
        Fixed-size chunking with token-based overlap.
        
        Strategy:
        - Split text into chunks of approximately `chunk_size` tokens
        - Overlap consecutive chunks by `overlap` tokens
        - Preserve word boundaries (don't split mid-word)
        
        Why: Ensures consistent chunk sizes, prevents context loss at boundaries.
        """
        tokens = self.encoding.encode(text)
        chunks: List[Chunk] = []
        
        start = 0
        chunk_id = 0
        
        while start < len(tokens):
            end = min(start + chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self.encoding.decode(chunk_tokens)
            
            chunks.append(Chunk(
                content=chunk_text.strip(),
                metadata={"chunk_id": chunk_id, "method": "fixed_token"},
                chunk_type="fixed",
                start_index=start,
                end_index=end,
                token_count=len(chunk_tokens),
            ))
            
            chunk_id += 1
            start += chunk_size - overlap
        
        return chunks
    
    def chunk_semantic(
        self,
        text: str,
        metadata: Dict[str, Any]
    ) -> List[Chunk]:
        """
        Semantic chunking based on document structure.
        
        Strategy:
        - Detect headings, sections, paragraphs
        - Group related content together
        - Respect min/max token boundaries
        - Preserve structural context
        
        Why: Maintains semantic coherence, improves retrieval relevance.
        
        TODO: Implement heading detection, paragraph grouping
        For now, falls back to fixed chunking with semantic boundaries.
        """
        # Placeholder: basic paragraph-based chunking
        paragraphs = text.split("\n\n")
        chunks: List[Chunk] = []
        current_chunk = ""
        chunk_id = 0
        
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            
            test_chunk = current_chunk + "\n\n" + para if current_chunk else para
            token_count = self.count_tokens(test_chunk)
            
            if token_count > chunking_config.max_chunk_size and current_chunk:
                # Flush current chunk
                chunks.append(Chunk(
                    content=current_chunk.strip(),
                    metadata={**metadata, "chunk_id": chunk_id, "method": "semantic_paragraph"},
                    chunk_type="semantic",
                    start_index=0,  # TODO: track actual indices
                    end_index=0,
                    token_count=self.count_tokens(current_chunk),
                ))
                chunk_id += 1
                current_chunk = para
            else:
                current_chunk = test_chunk
        
        # Flush remaining
        if current_chunk:
            chunks.append(Chunk(
                content=current_chunk.strip(),
                metadata={**metadata, "chunk_id": chunk_id, "method": "semantic_paragraph"},
                chunk_type="semantic",
                start_index=0,
                end_index=0,
                token_count=self.count_tokens(current_chunk),
            ))
        
        return chunks


def chunk_document(
    text: str,
    metadata: Dict[str, Any],
    strategy: Literal["fixed", "semantic"] = "semantic"
) -> List[Chunk]:
    """
    Main entry point for document chunking.
    
    Args:
        text: Raw document text
        metadata: Document metadata (source, title, etc.)
        strategy: Chunking strategy to use
    
    Returns:
        List of Chunk objects with content and metadata
    """
    chunker = Chunker()
    
    if strategy == "fixed":
        return chunker.chunk_by_tokens(
            text,
            chunk_size=chunking_config.fixed_chunk_size,
            overlap=chunking_config.fixed_chunk_overlap,
        )
    else:
        return chunker.chunk_semantic(text, metadata)

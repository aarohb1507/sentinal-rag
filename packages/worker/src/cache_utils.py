"""
Cache utilities for Redis key generation and management.
Handles embedding caching and document cache invalidation.
"""

import hashlib
from typing import Dict, Any


class CacheKeyManager:
    """Manages Redis key generation for embeddings and document caches."""
    
    # Prefixes for different cache types
    EMBEDDING_PREFIX = "embed:"
    DOCUMENT_PREFIX = "doc:"
    
    @staticmethod
    def generate_embedding_key(text: str) -> str:
        """
        Generate a consistent Redis key for embedding cache.
        
        Uses SHA256 hash to avoid collisions and handle long texts.
        Format: embed:sha256_hash
        
        Args:
            text: The text to hash
            
        Returns:
            Redis key for the embedding
        """
        text_hash = hashlib.sha256(text.encode()).hexdigest()
        return f"{CacheKeyManager.EMBEDDING_PREFIX}{text_hash}"
    
    @staticmethod
    def generate_document_key(document_id: str, version: int = 1) -> str:
        """
        Generate a Redis key for document metadata (for cache invalidation).
        
        Format: doc:document_id:version
        
        Args:
            document_id: Unique identifier for the document
            version: Document version number
            
        Returns:
            Redis key for the document metadata
        """
        return f"{CacheKeyManager.DOCUMENT_PREFIX}{document_id}:v{version}"
    
    @staticmethod
    def generate_embedding_for_document_key(document_id: str, chunk_index: int) -> str:
        """
        Generate a Redis key linking document to its chunk embeddings.
        
        Used for bulk invalidation when document changes.
        Format: doc:document_id:chunk:chunk_index
        
        Args:
            document_id: Unique identifier for the document
            chunk_index: Index of the chunk within the document
            
        Returns:
            Redis key for document chunk embedding
        """
        return f"{CacheKeyManager.DOCUMENT_PREFIX}{document_id}:chunk:{chunk_index}"

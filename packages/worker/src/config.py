"""
Configuration module for SentinelRAG worker.
Loads environment variables and provides typed config objects.
"""

import os
from typing import Literal
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseConfig(BaseSettings):
    """PostgreSQL database configuration."""
    
    host: str = "localhost"
    port: int = 5432
    database: str = "sentinelrag"
    user: str = "postgres"
    password: str = "postgres"
    
    model_config = SettingsConfigDict(env_prefix="DB_")


class RedisConfig(BaseSettings):
    """Redis cache configuration."""
    
    host: str = "localhost"
    port: int = 6379
    password: str | None = None
    
    model_config = SettingsConfigDict(env_prefix="REDIS_")


class OpenAIConfig(BaseSettings):
    """OpenAI API configuration."""
    
    api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    
    model_config = SettingsConfigDict(env_prefix="OPENAI_")


class ChunkingConfig(BaseSettings):
    """Document chunking configuration."""
    
    # Fixed-size chunking
    fixed_chunk_size: int = 512
    fixed_chunk_overlap: int = 128
    
    # Semantic chunking
    use_semantic_chunking: bool = True
    min_chunk_size: int = 256
    max_chunk_size: int = 1024
    
    model_config = SettingsConfigDict(env_prefix="CHUNKING_")


class WorkerConfig(BaseSettings):
    """Worker service configuration."""
    
    env: Literal["development", "production"] = "development"
    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "INFO"
    
    # Background job configuration
    max_workers: int = 4
    batch_size: int = 10
    
    model_config = SettingsConfigDict(env_prefix="WORKER_")


# Global config instances
db_config = DatabaseConfig()
redis_config = RedisConfig()
openai_config = OpenAIConfig()
chunking_config = ChunkingConfig()
worker_config = WorkerConfig()

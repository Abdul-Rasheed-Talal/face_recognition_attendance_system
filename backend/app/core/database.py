"""
Database Connection and Session Management using SQLAlchemy 2.0 Async Engine.
Supports SQLite (aiosqlite) for development and PostgreSQL (asyncpg) for production.
"""

import os
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from backend.app.core.config import settings

# Ensure data directory exists if using SQLite
if "sqlite" in settings.DATABASE_URL:
    os.makedirs("./data", exist_ok=True)

# Create asynchronous engine
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DB_ECHO,
    future=True,
    # SQLite-specific optimization
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

# Async session factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency providing a transactional async database session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Creates database schema tables if not present."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

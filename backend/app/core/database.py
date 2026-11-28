"""
Database Connection and Session Management using SQLAlchemy 2.0 Async Engine.
Supports SQLite (aiosqlite) for development and PostgreSQL (asyncpg) for production.
"""

import os
from typing import AsyncGenerator
from sqlalchemy import event, text
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

# SQLite disables foreign-key enforcement by default, so the FK cascades
# declared in entities.py were silently ignored (orphan sessions with a
# laboratory_id that matches no row, dangling student references, ...).
# Turn it on for every connection.
if "sqlite" in settings.DATABASE_URL:
    # NOTE: the listener must be registered on the *sync* engine —
    # registering it on the AsyncEngine raises
    # "NotImplementedError: asynchronous events are not implemented".
    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


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
    """Creates database schema tables if not present and applies lightweight column upgrades."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        if "sqlite" in settings.DATABASE_URL:
            # Ensure new timetable/rescheduling columns exist on lab_sessions
            res = await conn.execute(text("PRAGMA table_info(lab_sessions)"))
            existing_cols = {row[1] for row in res.fetchall()}
            migrations = {
                "timetable_slot_id": "ALTER TABLE lab_sessions ADD COLUMN timetable_slot_id VARCHAR(36)",
                "subject_title": "ALTER TABLE lab_sessions ADD COLUMN subject_title VARCHAR(120)",
                "teacher_display_name": "ALTER TABLE lab_sessions ADD COLUMN teacher_display_name VARCHAR(100)",
                "status_note": "ALTER TABLE lab_sessions ADD COLUMN status_note TEXT",
            }
            for col, stmt in migrations.items():
                if col not in existing_cols:
                    await conn.execute(text(stmt))


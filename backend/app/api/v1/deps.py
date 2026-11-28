"""
FastAPI Dependencies for Local CIT Lab Operator Access.
No login/signup required — the CIT Computer Lab workstation operates directly without authentication barriers.
"""

from typing import Optional
from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.database import get_db
from backend.app.models.entities import User


async def _get_or_create_local_operator(db: AsyncSession) -> User:
    """Returns the internal local CIT Lab Operator record (used only for DB foreign key audit fields)."""
    res = await db.execute(select(User).where(User.role == "ADMIN").limit(1))
    user = res.scalars().first()
    if user:
        return user

    res_any = await db.execute(select(User).limit(1))
    user = res_any.scalars().first()
    if user:
        return user

    # Create internal system operator if DB was freshly initialized
    operator = User(
        email="operator@cit.lab.local",
        password_hash="local-no-auth",
        full_name="CIT Lab Operator",
        role="ADMIN",
        is_active=True,
    )
    db.add(operator)
    await db.commit()
    await db.refresh(operator)
    return operator


async def get_current_user_optional(
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """Always returns the local CIT Lab Operator."""
    return await _get_or_create_local_operator(db)


async def get_current_user(
    db: AsyncSession = Depends(get_db),
) -> User:
    """Always returns the local CIT Lab Operator (no login required)."""
    return await _get_or_create_local_operator(db)


async def require_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Direct local access — no login required."""
    return user


async def require_teacher_or_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Direct local access — no login required."""
    return user

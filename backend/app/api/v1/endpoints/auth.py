"""
Authentication API Endpoints.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.database import get_db
from backend.app.core.security import verify_password, hash_password, create_access_token
from backend.app.models.entities import User
from backend.app.schemas.domain import LoginRequest, Token, UserOut, UserCreate
from backend.app.api.v1.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/login", response_model=Token)
async def login(credentials: LoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticates user and returns JWT bearer token."""
    res = await db.execute(select(User).where(User.email == credentials.email))
    user = res.scalars().first()

    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated.",
        )

    token = create_access_token(
        data={"sub": user.id, "email": user.email, "role": user.role}
    )

    return Token(
        access_token=token,
        token_type="bearer",
        role=user.role,
        full_name=user.full_name,
        user_id=user.id,
    )


@router.get("/me", response_model=UserOut)
async def get_my_profile(current_user: User = Depends(get_current_user)):
    """Returns profile of currently logged-in user."""
    return current_user


@router.post("/register-initial-admin", response_model=UserOut)
async def register_initial_admin(admin_data: UserCreate, db: AsyncSession = Depends(get_db)):
    """Seeds the initial administrator account if no users exist."""
    res = await db.execute(select(User))
    first_user = res.scalars().first()

    if first_user is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="System already initialized with user accounts. Contact existing administrator.",
        )

    admin = User(
        email=admin_data.email,
        password_hash=hash_password(admin_data.password),
        full_name=admin_data.full_name,
        role="ADMIN",
        is_active=True,
    )
    db.add(admin)
    await db.commit()
    await db.refresh(admin)
    return admin


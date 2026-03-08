"""Authentication endpoints: register, login, user management."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import (
    create_access_token,
    generate_user_id,
    get_current_user,
    hash_password,
    require_admin,
    verify_password,
)
from app.db.models import User, UserRole
from app.db.session import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["authentication"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=256)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: str
    email: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class UserListResponse(BaseModel):
    items: list[UserResponse]
    total: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, session: AsyncSession = Depends(get_session)) -> User:
    """Register a new user. The first user is automatically an admin."""

    # Check if email already exists
    existing = await session.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    # First user becomes admin, subsequent users are viewers
    user_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    role = UserRole.ADMIN if user_count == 0 else UserRole.VIEWER

    now = datetime.now(timezone.utc)
    user = User(
        id=generate_user_id(),
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
        role=role,
        is_active=True,
        created_at=now,
    )
    session.add(user)
    await session.commit()

    logger.info("Registered user %s (role=%s)", body.email, role.value)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)) -> dict:
    """Authenticate with email/password and receive a JWT token."""
    result = await session.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")

    token = create_access_token(user.id, user.role.value)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(get_current_user)) -> User:
    """Return the currently authenticated user."""
    return user


# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------


@router.get("/users", response_model=UserListResponse)
async def list_users(
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """List all users (admin only)."""
    total = (await session.execute(select(func.count(User.id)))).scalar_one()
    rows = (await session.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    return {"items": list(rows), "total": total}


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: RegisterRequest,
    admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Create a new user (admin only). New users default to viewer role."""
    existing = await session.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Email already registered")

    now = datetime.now(timezone.utc)
    user = User(
        id=generate_user_id(),
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
        role=UserRole.VIEWER,
        is_active=True,
        created_at=now,
    )
    session.add(user)
    await session.commit()
    return user

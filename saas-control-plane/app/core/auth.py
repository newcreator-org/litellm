"""JWT authentication utilities for the control-plane dashboard."""

import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, status
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models import User, UserRole
from app.db.session import get_session

# ---------------------------------------------------------------------------
# Password hashing (using bcrypt directly, not passlib which has compat issues)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# JWT token creation / verification
# ---------------------------------------------------------------------------

_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)
_api_key_header = APIKeyHeader(name="X-CP-API-Key", auto_error=False)


def create_access_token(user_id: str, role: str) -> str:
    """Create a JWT access token for a user."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": user_id,
        "role": role,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises on invalid/expired."""
    return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------


def generate_user_id() -> str:
    return secrets.token_hex(16)


async def get_current_user(
    bearer_token: str | None = Depends(_oauth2_scheme),
    api_key: str | None = Depends(_api_key_header),
    access_token: str | None = Cookie(None),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Resolve the current user from JWT (bearer or cookie) or API key.

    Priority: Bearer token > Cookie > API key (returns a synthetic admin user).
    """
    token = bearer_token or access_token

    if token:
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

        user = await session.get(User, user_id)
        if user is None or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
        return user

    # Fall back to API key → synthetic admin user
    if api_key:
        if hmac.compare_digest(api_key, settings.control_plane_api_key):
            return User(
                id="__api_key__",
                email="api-key@system",
                hashed_password="",
                display_name="API Key User",
                role=UserRole.ADMIN,
                is_active=True,
                created_at=datetime.now(timezone.utc),
            )

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency that requires the current user to be an admin."""
    if user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user

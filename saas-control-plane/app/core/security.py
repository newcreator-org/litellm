"""Simple API key authentication for the control plane management API."""

from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader

from app.core.config import settings

_api_key_header = APIKeyHeader(name="X-CP-API-Key", auto_error=False)


async def require_cp_api_key(api_key: str | None = Depends(_api_key_header)) -> str:
    """Dependency that enforces the control-plane API key."""
    if not api_key or api_key != settings.control_plane_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing control plane API key",
        )
    return api_key

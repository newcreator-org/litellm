"""Tests for the control plane API key authentication."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.core.security import require_cp_api_key


@pytest.mark.asyncio
async def test_valid_api_key():
    """A correct API key should pass authentication and be returned."""
    with patch("app.core.security.settings") as mock_settings:
        mock_settings.control_plane_api_key = "sk-test-key"
        result = await require_cp_api_key("sk-test-key")
        assert result == "sk-test-key"


@pytest.mark.asyncio
async def test_invalid_api_key():
    """A wrong API key should raise 401."""
    with patch("app.core.security.settings") as mock_settings:
        mock_settings.control_plane_api_key = "sk-test-key"
        with pytest.raises(HTTPException) as exc_info:
            await require_cp_api_key("wrong-key")
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_missing_api_key():
    """A None key should raise 401."""
    with patch("app.core.security.settings") as mock_settings:
        mock_settings.control_plane_api_key = "sk-test-key"
        with pytest.raises(HTTPException) as exc_info:
            await require_cp_api_key(None)
        assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_empty_api_key():
    """An empty string key should raise 401."""
    with patch("app.core.security.settings") as mock_settings:
        mock_settings.control_plane_api_key = "sk-test-key"
        with pytest.raises(HTTPException) as exc_info:
            await require_cp_api_key("")
        assert exc_info.value.status_code == 401


def test_timing_safe_comparison():
    """Verify that hmac.compare_digest is used (constant-time comparison)."""
    # This is a structural test: the function should use hmac.compare_digest
    import inspect

    source = inspect.getsource(require_cp_api_key)
    assert "hmac.compare_digest" in source, "Must use hmac.compare_digest for timing-safe comparison"

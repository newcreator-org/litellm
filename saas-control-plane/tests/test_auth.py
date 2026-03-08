"""Tests for JWT authentication: register, login, token validation, role-based access."""

import pytest

from app.core.auth import (
    create_access_token,
    decode_token,
    hash_password,
    verify_password,
)

# ---------------------------------------------------------------------------
# Password hashing unit tests
# ---------------------------------------------------------------------------


def test_hash_and_verify_password():
    hashed = hash_password("mypassword")
    assert verify_password("mypassword", hashed)
    assert not verify_password("wrongpassword", hashed)


def test_hash_password_unique():
    h1 = hash_password("same")
    h2 = hash_password("same")
    assert h1 != h2  # bcrypt uses random salt


# ---------------------------------------------------------------------------
# JWT token unit tests
# ---------------------------------------------------------------------------


def test_create_and_decode_token(test_settings):
    from unittest.mock import patch

    with patch("app.core.auth.settings", test_settings):
        token = create_access_token("user-123", "admin")
        payload = decode_token(token)
        assert payload["sub"] == "user-123"
        assert payload["role"] == "admin"


def test_decode_invalid_token(test_settings):
    from unittest.mock import patch

    import jwt

    with patch("app.core.auth.settings", test_settings):
        with pytest.raises(jwt.InvalidTokenError):
            decode_token("invalid.token.here")


def test_decode_expired_token(test_settings):
    from datetime import datetime, timedelta, timezone
    from unittest.mock import patch

    import jwt as pyjwt

    with patch("app.core.auth.settings", test_settings):
        expired_payload = {
            "sub": "user-123",
            "role": "admin",
            "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        }
        token = pyjwt.encode(expired_payload, test_settings.jwt_secret_key, algorithm="HS256")
        with pytest.raises(pyjwt.ExpiredSignatureError):
            decode_token(token)


# ---------------------------------------------------------------------------
# Registration API tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_register_first_user_becomes_admin(app_client):
    resp = await app_client.post(
        "/auth/register",
        json={"email": "admin@test.com", "password": "password123", "display_name": "Admin"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["email"] == "admin@test.com"
    assert data["role"] == "admin"
    assert data["is_active"] is True


@pytest.mark.asyncio
async def test_register_second_user_becomes_viewer(app_client):
    # First user (admin)
    await app_client.post(
        "/auth/register",
        json={"email": "first@test.com", "password": "password123", "display_name": "First"},
    )
    # Second user (viewer)
    resp = await app_client.post(
        "/auth/register",
        json={"email": "second@test.com", "password": "password123", "display_name": "Second"},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "viewer"


@pytest.mark.asyncio
async def test_register_duplicate_email(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "dup@test.com", "password": "password123", "display_name": "Dup"},
    )
    resp = await app_client.post(
        "/auth/register",
        json={"email": "dup@test.com", "password": "password456", "display_name": "Dup2"},
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_register_short_password(app_client):
    resp = await app_client.post(
        "/auth/register",
        json={"email": "short@test.com", "password": "short", "display_name": "Short"},
    )
    assert resp.status_code == 422  # Pydantic validation: min_length=8


# ---------------------------------------------------------------------------
# Login API tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_success(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "login@test.com", "password": "password123", "display_name": "Login"},
    )
    resp = await app_client.post(
        "/auth/login",
        json={"email": "login@test.com", "password": "password123"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "wrong@test.com", "password": "password123", "display_name": "Wrong"},
    )
    resp = await app_client.post(
        "/auth/login",
        json={"email": "wrong@test.com", "password": "badpassword"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_email(app_client):
    resp = await app_client.post(
        "/auth/login",
        json={"email": "noone@test.com", "password": "password123"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /auth/me endpoint tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_me_with_jwt(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "me@test.com", "password": "password123", "display_name": "Me"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "me@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "me@test.com"


@pytest.mark.asyncio
async def test_me_with_api_key(app_client):
    resp = await app_client.get("/auth/me", headers={"X-CP-API-Key": "sk-test-key"})
    assert resp.status_code == 200
    assert resp.json()["email"] == "api-key@system"


@pytest.mark.asyncio
async def test_me_no_auth(app_client):
    resp = await app_client.get("/auth/me")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# JWT auth on org endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_org_create_with_jwt_admin(app_client):
    """Admin user can create orgs via JWT."""
    await app_client.post(
        "/auth/register",
        json={"email": "orgadmin@test.com", "password": "password123", "display_name": "OrgAdmin"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "orgadmin@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.post(
        "/orgs",
        json={"slug": "jwt-org", "display_name": "JWT Org"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_org_create_with_jwt_viewer_forbidden(app_client):
    """Viewer user cannot create orgs."""
    # First user = admin
    await app_client.post(
        "/auth/register",
        json={"email": "admin2@test.com", "password": "password123", "display_name": "Admin2"},
    )
    # Second user = viewer
    await app_client.post(
        "/auth/register",
        json={"email": "viewer@test.com", "password": "password123", "display_name": "Viewer"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "viewer@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.post(
        "/orgs",
        json={"slug": "viewer-org", "display_name": "Viewer Org"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_org_list_with_jwt_viewer(app_client):
    """Viewer user can list orgs."""
    # Register admin + create org
    await app_client.post(
        "/auth/register",
        json={"email": "listadmin@test.com", "password": "password123", "display_name": "ListAdmin"},
    )
    # Register viewer
    await app_client.post(
        "/auth/register",
        json={"email": "listviewer@test.com", "password": "password123", "display_name": "ListViewer"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "listviewer@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.get("/orgs", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Admin user management
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_users_admin(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "useradmin@test.com", "password": "password123", "display_name": "UserAdmin"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "useradmin@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.get("/auth/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1


@pytest.mark.asyncio
async def test_list_users_viewer_forbidden(app_client):
    await app_client.post(
        "/auth/register",
        json={"email": "usradmin2@test.com", "password": "password123", "display_name": "Admin"},
    )
    await app_client.post(
        "/auth/register",
        json={"email": "usrviewer@test.com", "password": "password123", "display_name": "Viewer"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "usrviewer@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.get("/auth/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403

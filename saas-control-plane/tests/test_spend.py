"""Tests for cost tracking: spend sync and spend history endpoints."""

import pytest

API_KEY_HEADER = {"X-CP-API-Key": "sk-test-key"}


# ---------------------------------------------------------------------------
# Get spend (read endpoint)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_org_spend_empty(app_client):
    """Get spend for an org with no spend history."""
    create = await app_client.post(
        "/orgs",
        json={"slug": "spend-empty", "display_name": "Spend Empty"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.get(f"/orgs/{org_id}/spend", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["org_id"] == org_id
    assert data["current_spend"] == 0.0
    assert data["spend_history"] == []


@pytest.mark.asyncio
async def test_get_org_spend_with_budget(app_client):
    """Get spend for an org with a budget set."""
    create = await app_client.post(
        "/orgs",
        json={"slug": "spend-budget", "display_name": "Spend Budget", "max_budget": 100.0},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.get(f"/orgs/{org_id}/spend", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["max_budget"] == 100.0
    assert data["budget_remaining"] == 100.0


@pytest.mark.asyncio
async def test_get_org_spend_not_found(app_client):
    resp = await app_client.get("/orgs/nonexistent/spend", headers=API_KEY_HEADER)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Sync spend (admin endpoint)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_org_spend_not_active(app_client):
    """Sync spend for a provisioning org returns synced=False."""
    create = await app_client.post(
        "/orgs",
        json={"slug": "sync-prov", "display_name": "Sync Prov"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.post(f"/orgs/{org_id}/sync-spend", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["synced"] is False
    assert "not active" in data["error"].lower()


@pytest.mark.asyncio
async def test_sync_org_spend_not_found(app_client):
    resp = await app_client.post("/orgs/nonexistent/sync-spend", headers=API_KEY_HEADER)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Bulk sync (admin endpoint)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_all_spend_empty(app_client):
    """Sync all with no active orgs returns empty results."""
    resp = await app_client.post("/admin/sync-all-spend", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data["results"], list)
    assert data["total_synced"] >= 0


# ---------------------------------------------------------------------------
# Auth on spend endpoints
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sync_spend_no_auth(app_client):
    resp = await app_client.post("/orgs/someid/sync-spend")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_spend_no_auth(app_client):
    resp = await app_client.get("/orgs/someid/spend")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sync_spend_viewer_forbidden(app_client):
    """Viewer cannot trigger spend sync."""
    # Register admin + viewer
    await app_client.post(
        "/auth/register",
        json={"email": "spendsyncadmin@test.com", "password": "password123", "display_name": "Admin"},
    )
    await app_client.post(
        "/auth/register",
        json={"email": "spendsyncviewer@test.com", "password": "password123", "display_name": "Viewer"},
    )
    login = await app_client.post(
        "/auth/login",
        json={"email": "spendsyncviewer@test.com", "password": "password123"},
    )
    token = login.json()["access_token"]

    resp = await app_client.post(
        "/admin/sync-all-spend",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403

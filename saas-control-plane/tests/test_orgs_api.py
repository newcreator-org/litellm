"""Tests for organisation management API endpoints."""

import asyncio

import pytest

API_KEY_HEADER = {"X-CP-API-Key": "sk-test-key"}


@pytest.mark.asyncio
async def test_health(app_client):
    resp = await app_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"


# ---------------------------------------------------------------------------
# CREATE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_org(app_client):
    resp = await app_client.post(
        "/orgs",
        json={"slug": "acme", "display_name": "Acme Corp"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["slug"] == "acme"
    assert data["display_name"] == "Acme Corp"
    # Provisioning is async; status is "provisioning" immediately after create
    assert data["status"] == "provisioning"
    assert data["master_key"].startswith("sk-org-")
    # Allow background task to complete
    await asyncio.sleep(0.1)


@pytest.mark.asyncio
async def test_create_org_custom_master_key(app_client):
    resp = await app_client.post(
        "/orgs",
        json={"slug": "custom-key", "display_name": "Custom", "master_key": "sk-my-key"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 201
    assert resp.json()["master_key"] == "sk-my-key"


@pytest.mark.asyncio
async def test_create_org_duplicate_slug(app_client):
    await app_client.post(
        "/orgs",
        json={"slug": "dup-test", "display_name": "First"},
        headers=API_KEY_HEADER,
    )
    resp = await app_client.post(
        "/orgs",
        json={"slug": "dup-test", "display_name": "Second"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_org_invalid_slug(app_client):
    resp = await app_client.post(
        "/orgs",
        json={"slug": "BAD SLUG!", "display_name": "Bad"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_org_no_auth(app_client):
    resp = await app_client.post(
        "/orgs",
        json={"slug": "no-auth", "display_name": "No Auth"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# LIST
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_orgs_empty(app_client):
    resp = await app_client.get("/orgs", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 0
    assert isinstance(data["items"], list)


@pytest.mark.asyncio
async def test_list_orgs_with_data(app_client):
    await app_client.post("/orgs", json={"slug": "list-a1", "display_name": "A1"}, headers=API_KEY_HEADER)
    await app_client.post("/orgs", json={"slug": "list-b2", "display_name": "B2"}, headers=API_KEY_HEADER)

    resp = await app_client.get("/orgs", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["total"] >= 2


@pytest.mark.asyncio
async def test_list_orgs_pagination(app_client):
    resp = await app_client.get("/orgs?offset=0&limit=1", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) <= 1


# ---------------------------------------------------------------------------
# GET
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_org(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "get-test", "display_name": "Get Test"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.get(f"/orgs/{org_id}", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    assert resp.json()["slug"] == "get-test"


@pytest.mark.asyncio
async def test_get_org_not_found(app_client):
    resp = await app_client.get("/orgs/nonexistent-id", headers=API_KEY_HEADER)
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# UPDATE (PATCH)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_org_display_name(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "update-test", "display_name": "Original"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.patch(
        f"/orgs/{org_id}",
        json={"display_name": "Updated"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Updated"


@pytest.mark.asyncio
async def test_update_org_set_budget(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "budget-test", "display_name": "Budget Test"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.patch(
        f"/orgs/{org_id}",
        json={"max_budget": 100.0},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 200
    assert resp.json()["max_budget"] == 100.0


@pytest.mark.asyncio
async def test_update_org_clear_budget_with_null(app_client):
    """PATCH with explicit null for max_budget should clear the budget."""
    create = await app_client.post(
        "/orgs",
        json={"slug": "null-budget", "display_name": "Null Budget", "max_budget": 50.0},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]
    assert create.json()["max_budget"] == 50.0

    resp = await app_client.patch(
        f"/orgs/{org_id}",
        json={"max_budget": None},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 200
    assert resp.json()["max_budget"] is None


# ---------------------------------------------------------------------------
# DELETE
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_org(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "del-test", "display_name": "Delete Test"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]

    resp = await app_client.delete(f"/orgs/{org_id}", headers=API_KEY_HEADER)
    assert resp.status_code == 204

    # Confirm gone
    resp = await app_client.get(f"/orgs/{org_id}", headers=API_KEY_HEADER)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_org_allows_slug_reuse(app_client):
    """After deletion, the same slug can be used again."""
    await app_client.post(
        "/orgs",
        json={"slug": "reuse-me", "display_name": "First"},
        headers=API_KEY_HEADER,
    )
    org_id = (await app_client.get("/orgs", headers=API_KEY_HEADER)).json()["items"]
    target = [o for o in org_id if o["slug"] == "reuse-me"][0]

    await app_client.delete(f"/orgs/{target['id']}", headers=API_KEY_HEADER)

    # Re-create with same slug
    resp = await app_client.post(
        "/orgs",
        json={"slug": "reuse-me", "display_name": "Second"},
        headers=API_KEY_HEADER,
    )
    assert resp.status_code == 201


# ---------------------------------------------------------------------------
# ACTIONS (stop/start/status)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_stop_and_start_org(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "stop-start", "display_name": "Stop Start"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]
    # Allow background provisioning to complete
    await asyncio.sleep(0.1)

    # Stop
    resp = await app_client.post(f"/orgs/{org_id}/stop", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    assert resp.json()["status"] == "suspended"

    # Start
    resp = await app_client.post(f"/orgs/{org_id}/start", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


@pytest.mark.asyncio
async def test_org_instance_status(app_client):
    create = await app_client.post(
        "/orgs",
        json={"slug": "status-test", "display_name": "Status Test"},
        headers=API_KEY_HEADER,
    )
    org_id = create.json()["id"]
    # Allow background provisioning to complete
    await asyncio.sleep(0.1)

    resp = await app_client.get(f"/orgs/{org_id}/status", headers=API_KEY_HEADER)
    assert resp.status_code == 200
    data = resp.json()
    assert data["org_id"] == org_id
    assert "container_status" in data

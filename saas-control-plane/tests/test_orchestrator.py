"""Tests for orchestrator backends."""

import asyncio
from unittest.mock import patch

import pytest

from app.orchestrator.base import ContainerConfig, ContainerInfo
from app.orchestrator.docker_backend import DockerBackend

# ---------------------------------------------------------------------------
# ContainerConfig / ContainerInfo dataclass tests
# ---------------------------------------------------------------------------


def test_container_config_defaults():
    cfg = ContainerConfig(
        org_id="id1",
        org_slug="acme",
        image="ghcr.io/berriai/litellm:main-stable",
        database_url="postgresql://u:p@host/db",
        redis_host="redis",
        redis_port=6379,
        redis_password="",
        redis_prefix="org:acme",
        master_key="sk-test",
    )
    assert cfg.env_extra is None


def test_container_info_fields():
    info = ContainerInfo(container_id="abc123", url="http://test:4000", port=4100, status="running")
    assert info.container_id == "abc123"
    assert info.url == "http://test:4000"
    assert info.port == 4100
    assert info.status == "running"


# ---------------------------------------------------------------------------
# DockerBackend._container_name
# ---------------------------------------------------------------------------


def test_container_name():
    assert DockerBackend._container_name("acme") == "litellm-org-acme"
    assert DockerBackend._container_name("big-corp") == "litellm-org-big-corp"


# ---------------------------------------------------------------------------
# DockerBackend.create_instance — env_extra protection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_instance_env_extra_protection():
    """Protected env keys in env_extra must be filtered out."""
    backend = DockerBackend()

    config = ContainerConfig(
        org_id="id1",
        org_slug="acme",
        image="litellm:test",
        database_url="postgresql://u:p@host/db",
        redis_host="redis",
        redis_port=6379,
        redis_password="",
        redis_prefix="org:acme",
        master_key="sk-test",
        env_extra={
            "DATABASE_URL": "evil://hacker",
            "LITELLM_MASTER_KEY": "stolen-key",
            "CUSTOM_VAR": "allowed",
        },
    )

    captured_cmd: list[str] = []

    async def mock_run(cmd):
        captured_cmd.extend(cmd)
        # Return container ID for docker run
        return (0, "abc123def456", "")

    with patch.object(backend, "_run", side_effect=mock_run), \
         patch.object(backend, "_allocate_port", return_value=4100), \
         patch("app.orchestrator.docker_backend.settings") as mock_settings:
        mock_settings.litellm_internal_port = 4000
        await backend.create_instance(config)

    cmd_str = " ".join(captured_cmd)
    # CUSTOM_VAR should be present
    assert "CUSTOM_VAR=allowed" in cmd_str
    # Protected keys should use the original config values, not env_extra overrides
    assert "DATABASE_URL=evil://hacker" not in cmd_str
    assert "LITELLM_MASTER_KEY=stolen-key" not in cmd_str
    assert "DATABASE_URL=postgresql://u:p@host/db" in cmd_str
    assert "LITELLM_MASTER_KEY=sk-test" in cmd_str


# ---------------------------------------------------------------------------
# DockerBackend._allocate_port — race condition lock
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_allocate_port_concurrent_safety():
    """Concurrent port allocations should not produce duplicate ports."""
    backend = DockerBackend()
    # Reset _next_port for deterministic test
    DockerBackend._next_port = 4100

    async def mock_run(cmd):
        # Simulate docker ps returning no used ports (with a small delay)
        await asyncio.sleep(0.01)
        return (0, "", "")

    with patch.object(backend, "_run", side_effect=mock_run):
        # Run 5 concurrent allocations
        ports = await asyncio.gather(
            backend._allocate_port(),
            backend._allocate_port(),
            backend._allocate_port(),
            backend._allocate_port(),
            backend._allocate_port(),
        )

    # All ports should be unique
    assert len(set(ports)) == len(ports), f"Duplicate ports detected: {ports}"


# ---------------------------------------------------------------------------
# DockerBackend.create_instance — URL uses container name, not localhost
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_instance_uses_docker_network_url():
    """Container URL should use container name and internal port, not localhost."""
    backend = DockerBackend()

    config = ContainerConfig(
        org_id="id1",
        org_slug="acme",
        image="litellm:test",
        database_url="postgresql://u:p@host/db",
        redis_host="redis",
        redis_port=6379,
        redis_password="",
        redis_prefix="org:acme",
        master_key="sk-test",
    )

    async def mock_run(cmd):
        return (0, "abc123def456", "")

    with patch.object(backend, "_run", side_effect=mock_run), \
         patch.object(backend, "_allocate_port", return_value=4100), \
         patch("app.orchestrator.docker_backend.settings") as mock_settings:
        mock_settings.litellm_internal_port = 4000
        result = await backend.create_instance(config)

    assert "localhost" not in result.url
    assert "litellm-org-acme" in result.url
    assert ":4000" in result.url


# ---------------------------------------------------------------------------
# DockerBackend.get_instance_status
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_instance_status_running():
    backend = DockerBackend()

    async def mock_run(cmd):
        return (0, "running", "")

    with patch.object(backend, "_run", side_effect=mock_run):
        status = await backend.get_instance_status("abc123")
    assert status == "running"


@pytest.mark.asyncio
async def test_get_instance_status_error():
    backend = DockerBackend()

    async def mock_run(cmd):
        return (1, "", "not found")

    with patch.object(backend, "_run", side_effect=mock_run):
        status = await backend.get_instance_status("nonexistent")
    assert status == "error"

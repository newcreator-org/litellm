"""Shared fixtures for the control plane test suite."""

import asyncio
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.db.models import Base

# ---------------------------------------------------------------------------
# Event loop
# ---------------------------------------------------------------------------

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ---------------------------------------------------------------------------
# In-memory SQLite for fast isolated tests
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def async_engine():
    # Use StaticPool so all connections share the same in-memory SQLite DB.
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(async_engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ---------------------------------------------------------------------------
# Override settings for tests
# ---------------------------------------------------------------------------

@pytest.fixture
def test_settings() -> Settings:
    return Settings(
        database_url="sqlite+aiosqlite://",
        shared_pg_host="localhost",
        shared_pg_port=5432,
        shared_pg_user="test",
        shared_pg_password="test",
        shared_pg_database="test_db",
        redis_host="localhost",
        redis_port=6379,
        redis_password="",
        control_plane_api_key="sk-test-key",
        jwt_secret_key="test-jwt-secret",
        jwt_algorithm="HS256",
        jwt_expire_minutes=60,
        orchestrator_backend="docker",
    )


# ---------------------------------------------------------------------------
# FastAPI test client with mocked dependencies
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def app_client(async_engine, test_settings) -> AsyncIterator[AsyncClient]:
    """Create an HTTPX AsyncClient wired to the FastAPI app with test DB."""
    from app.db.session import get_session

    factory = async_sessionmaker(async_engine, class_=AsyncSession, expire_on_commit=False)

    async def _override_session():
        async with factory() as session:
            yield session

    # Patch settings before importing the app
    with patch("app.core.config.settings", test_settings), \
         patch("app.core.security.settings", test_settings), \
         patch("app.core.auth.settings", test_settings), \
         patch("app.api.orgs.settings", test_settings), \
         patch("app.db.schema_manager.create_org_schema", new_callable=AsyncMock), \
         patch("app.db.schema_manager.drop_org_schema", new_callable=AsyncMock), \
         patch("app.api.orgs.create_org_schema", new_callable=AsyncMock), \
         patch("app.api.orgs.drop_org_schema", new_callable=AsyncMock), \
         patch("app.orchestrator.factory.get_orchestrator") as mock_get_orch, \
         patch("app.api.orgs.get_orchestrator") as mock_get_orch2, \
         patch("app.api.orgs.async_session_factory", factory):

        from app.orchestrator.base import ContainerInfo

        mock_orch = AsyncMock()
        mock_orch.create_instance.return_value = ContainerInfo(
            container_id="test-container-123",
            url="http://litellm-org-test:4000",
            port=4100,
            status="running",
        )
        mock_orch.start_instance.return_value = ContainerInfo(
            container_id="test-container-123",
            url="http://litellm-org-test:4000",
            port=4100,
            status="running",
        )
        mock_orch.stop_instance.return_value = None
        mock_orch.destroy_instance.return_value = None
        mock_orch.get_instance_status.return_value = "running"
        mock_get_orch.return_value = mock_orch
        mock_get_orch2.return_value = mock_orch

        # Build the app fresh with all routers
        app = FastAPI()

        from app.api.auth import router as auth_router
        from app.api.orgs import router as orgs_router
        from app.api.schemas import HealthResponse
        from app.api.spend import router as spend_router

        @app.get("/health", response_model=HealthResponse, tags=["health"])
        async def health() -> dict:
            return {"status": "ok", "version": "0.1.0", "orchestrator": test_settings.orchestrator_backend}

        app.include_router(auth_router)
        app.include_router(orgs_router)
        app.include_router(spend_router)

        app.dependency_overrides[get_session] = _override_session

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client

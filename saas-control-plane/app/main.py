"""LiteLLM SaaS Control Plane — main FastAPI application."""

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.orgs import router as orgs_router
from app.api.schemas import HealthResponse
from app.api.spend import router as spend_router
from app.core.config import settings
from app.dashboard.router import router as dashboard_router
from app.db.models import Base
from app.db.session import engine
from app.gateway.router import router as gateway_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Startup / shutdown lifecycle."""
    # Create control-plane tables (organisations, etc.)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Control-plane database tables created")

    # Optionally ensure the shared SaaS database exists
    try:
        from app.db.schema_manager import ensure_shared_database_exists

        await ensure_shared_database_exists()
    except Exception as exc:
        logger.warning("Could not ensure shared database: %s (will retry on first org creation)", exc)

    yield

    await engine.dispose()


app = FastAPI(
    title="LiteLLM SaaS Control Plane",
    description="Multi-tenant management layer for LiteLLM instances",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Health ----------


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health() -> dict:
    return {
        "status": "ok",
        "version": "0.1.0",
        "orchestrator": settings.orchestrator_backend,
    }


# ---------- Routers ----------

# Authentication (JWT + API key)
app.include_router(auth_router)

# Organisation management (protected by JWT / API key)
app.include_router(orgs_router)

# Cost tracking
app.include_router(spend_router)

# Admin dashboard (server-rendered HTML)
app.include_router(dashboard_router)

# Gateway (catch-all proxy) — must be last so /orgs, /auth, /dashboard take priority
app.include_router(gateway_router)

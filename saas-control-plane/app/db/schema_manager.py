"""Manage per-org PostgreSQL schemas and run LiteLLM Prisma migrations."""

import asyncio
import logging
import os
from pathlib import Path

import asyncpg

from app.core.config import settings

logger = logging.getLogger(__name__)

# Path to the LiteLLM schema.prisma (relative to project root)
_LITELLM_ROOT = Path(__file__).resolve().parents[3]  # saas-control-plane -> litellm repo root
PRISMA_SCHEMA_PATH = _LITELLM_ROOT / "schema.prisma"


def _org_dsn(schema_name: str) -> str:
    """Build a PostgreSQL DSN for an org schema (for Prisma / LiteLLM)."""
    return (
        f"postgresql://{settings.shared_pg_user}:{settings.shared_pg_password}"
        f"@{settings.shared_pg_host}:{settings.shared_pg_port}"
        f"/{settings.shared_pg_database}?schema={schema_name}"
    )


async def _get_raw_connection() -> asyncpg.Connection:
    return await asyncpg.connect(
        host=settings.shared_pg_host,
        port=settings.shared_pg_port,
        user=settings.shared_pg_user,
        password=settings.shared_pg_password,
        database=settings.shared_pg_database,
    )


async def create_org_schema(schema_name: str) -> None:
    """Create a new PostgreSQL schema for a tenant and run Prisma migrations."""
    conn = await _get_raw_connection()
    try:
        # Use double-quoting for safety; schema_name is already validated as slug.
        await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema_name}"')
        logger.info("Created PostgreSQL schema: %s", schema_name)
    finally:
        await conn.close()

    # Run Prisma db push to create tables inside the new schema.
    await _run_prisma_push(schema_name)


async def drop_org_schema(schema_name: str) -> None:
    """Drop a tenant schema and all its objects (irreversible)."""
    conn = await _get_raw_connection()
    try:
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema_name}" CASCADE')
        logger.info("Dropped PostgreSQL schema: %s", schema_name)
    finally:
        await conn.close()


async def _run_prisma_push(schema_name: str) -> None:
    """Run `prisma db push` against the org schema to create all LiteLLM tables."""
    dsn = _org_dsn(schema_name)
    env = {**os.environ, "DATABASE_URL": dsn}

    logger.info("Running prisma db push for schema %s ...", schema_name)
    proc = await asyncio.create_subprocess_exec(
        "prisma",
        "db",
        "push",
        "--schema",
        str(PRISMA_SCHEMA_PATH),
        "--skip-generate",
        "--accept-data-loss",
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        err_msg = stderr.decode() if stderr else stdout.decode()
        logger.error("prisma db push failed for %s: %s", schema_name, err_msg)
        raise RuntimeError(f"prisma db push failed for schema {schema_name}: {err_msg}")

    logger.info("prisma db push succeeded for schema %s", schema_name)


async def ensure_shared_database_exists() -> None:
    """Create the shared SaaS database if it doesn't exist yet.

    Connects to the default 'postgres' database to run CREATE DATABASE.
    """
    conn = await asyncpg.connect(
        host=settings.shared_pg_host,
        port=settings.shared_pg_port,
        user=settings.shared_pg_user,
        password=settings.shared_pg_password,
        database="postgres",
    )
    try:
        exists = await conn.fetchval(
            "SELECT 1 FROM pg_database WHERE datname = $1",
            settings.shared_pg_database,
        )
        if not exists:
            # CREATE DATABASE cannot run inside a transaction block.
            await conn.execute(f'CREATE DATABASE "{settings.shared_pg_database}"')
            logger.info("Created shared database: %s", settings.shared_pg_database)
        else:
            logger.info("Shared database already exists: %s", settings.shared_pg_database)
    finally:
        await conn.close()

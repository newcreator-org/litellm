"""Tests for per-org PostgreSQL schema management."""

from unittest.mock import AsyncMock, patch

import pytest

from app.db.schema_manager import _org_dsn, create_org_schema, drop_org_schema


def test_org_dsn_basic():
    """DSN should include schema in query string."""
    with patch("app.db.schema_manager.settings") as mock_settings:
        mock_settings.shared_pg_user = "user"
        mock_settings.shared_pg_password = "pass"
        mock_settings.shared_pg_host = "db.example.com"
        mock_settings.shared_pg_port = 5432
        mock_settings.shared_pg_database = "litellm_saas"

        dsn = _org_dsn("org_acme")
        assert dsn == "postgresql://user:pass@db.example.com:5432/litellm_saas?schema=org_acme"


def test_org_dsn_special_chars_encoded():
    """Special characters in user/password must be URL-encoded."""
    with patch("app.db.schema_manager.settings") as mock_settings:
        mock_settings.shared_pg_user = "user@domain"
        mock_settings.shared_pg_password = "p@ss/w?rd#"
        mock_settings.shared_pg_host = "localhost"
        mock_settings.shared_pg_port = 5432
        mock_settings.shared_pg_database = "litellm_saas"

        dsn = _org_dsn("org_test")
        # @ -> %40, / -> %2F, ? -> %3F, # -> %23
        assert "user%40domain" in dsn
        assert "p%40ss%2Fw%3Frd%23" in dsn
        assert "?schema=org_test" in dsn


@pytest.mark.asyncio
async def test_create_org_schema():
    """create_org_schema should CREATE SCHEMA and then run prisma push."""
    mock_conn = AsyncMock()

    with patch("app.db.schema_manager._get_raw_connection", return_value=mock_conn), \
         patch("app.db.schema_manager._run_prisma_push", new_callable=AsyncMock) as mock_prisma:

        await create_org_schema("org_acme")

        mock_conn.execute.assert_called_once_with('CREATE SCHEMA IF NOT EXISTS "org_acme"')
        mock_conn.close.assert_called_once()
        mock_prisma.assert_called_once_with("org_acme")


@pytest.mark.asyncio
async def test_create_org_schema_closes_conn_on_error():
    """Connection must be closed even if CREATE SCHEMA fails."""
    mock_conn = AsyncMock()
    mock_conn.execute.side_effect = RuntimeError("DB error")

    with patch("app.db.schema_manager._get_raw_connection", return_value=mock_conn):
        with pytest.raises(RuntimeError, match="DB error"):
            await create_org_schema("org_fail")

        mock_conn.close.assert_called_once()


@pytest.mark.asyncio
async def test_drop_org_schema():
    """drop_org_schema should DROP SCHEMA CASCADE."""
    mock_conn = AsyncMock()

    with patch("app.db.schema_manager._get_raw_connection", return_value=mock_conn):
        await drop_org_schema("org_old")

        mock_conn.execute.assert_called_once_with('DROP SCHEMA IF EXISTS "org_old" CASCADE')
        mock_conn.close.assert_called_once()


@pytest.mark.asyncio
async def test_drop_org_schema_closes_conn_on_error():
    """Connection must be closed even if DROP SCHEMA fails."""
    mock_conn = AsyncMock()
    mock_conn.execute.side_effect = RuntimeError("DB error")

    with patch("app.db.schema_manager._get_raw_connection", return_value=mock_conn):
        with pytest.raises(RuntimeError, match="DB error"):
            await drop_org_schema("org_fail")

        mock_conn.close.assert_called_once()

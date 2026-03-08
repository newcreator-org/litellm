"""Organisation management endpoints."""

import asyncio
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import OrgCreateRequest, OrgListResponse, OrgResponse, OrgUpdateRequest
from app.core.config import settings
from app.core.security import require_cp_api_key
from app.db.models import Organization, OrgStatus
from app.db.schema_manager import _org_dsn, create_org_schema, drop_org_schema
from app.db.session import async_session_factory, get_session
from app.orchestrator.base import ContainerConfig
from app.orchestrator.factory import get_orchestrator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/orgs", tags=["organisations"], dependencies=[Depends(require_cp_api_key)])

# Strong references to background tasks so they aren't garbage-collected mid-execution.
# See https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_background_tasks: set[asyncio.Task[None]] = set()


def _generate_id() -> str:
    return secrets.token_hex(16)


def _generate_master_key() -> str:
    return f"sk-org-{secrets.token_urlsafe(32)}"


# ---------- CREATE ----------


@router.post("", response_model=OrgResponse, status_code=status.HTTP_201_CREATED)
async def create_org(body: OrgCreateRequest, session: AsyncSession = Depends(get_session)) -> Organization:
    """Provision a new organisation: DB schema + LiteLLM container."""

    # Check slug uniqueness
    existing = await session.execute(select(Organization).where(Organization.slug == body.slug))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"Organisation slug '{body.slug}' already exists")

    org_id = _generate_id()
    schema_name = f"org_{body.slug.replace('-', '_')}"
    redis_prefix = f"org:{body.slug}"
    master_key = body.master_key or _generate_master_key()

    now = datetime.now(timezone.utc)
    org = Organization(
        id=org_id,
        slug=body.slug,
        display_name=body.display_name,
        status=OrgStatus.PROVISIONING,
        pg_schema=schema_name,
        redis_prefix=redis_prefix,
        master_key=master_key,
        max_budget=body.max_budget,
        created_at=now,
        updated_at=now,
    )
    session.add(org)
    await session.commit()

    # Fire-and-forget background provisioning so POST returns quickly.
    task = asyncio.create_task(
        _provision_org(
            org_id=org_id,
            slug=body.slug,
            schema_name=schema_name,
            redis_prefix=redis_prefix,
            master_key=master_key,
            env_extra=body.env_extra,
        )
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return org


async def _provision_org(
    *,
    org_id: str,
    slug: str,
    schema_name: str,
    redis_prefix: str,
    master_key: str,
    env_extra: dict[str, str] | None,
) -> None:
    """Background task: create DB schema + start LiteLLM container for an org."""
    async with async_session_factory() as session:
        org = await session.get(Organization, org_id)
        if org is None:
            logger.error("Org %s disappeared before provisioning finished", org_id)
            return

        try:
            # 1. Create PostgreSQL schema + tables
            await create_org_schema(schema_name)

            # 2. Start LiteLLM container
            orchestrator = get_orchestrator()
            container = await orchestrator.create_instance(
                ContainerConfig(
                    org_id=org_id,
                    org_slug=slug,
                    image=settings.litellm_image,
                    database_url=_org_dsn(schema_name),
                    redis_host=settings.redis_host,
                    redis_port=settings.redis_port,
                    redis_password=settings.redis_password,
                    redis_prefix=redis_prefix,
                    master_key=master_key,
                    env_extra=env_extra,
                )
            )

            org.container_id = container.container_id
            org.container_url = container.url
            org.litellm_port = container.port
            org.status = OrgStatus.ACTIVE

        except Exception as exc:
            logger.exception("Failed to provision org %s", slug)
            org.status = OrgStatus.ERROR
            org.error_message = str(exc)

        await session.commit()


# ---------- LIST ----------


@router.get("", response_model=OrgListResponse)
async def list_orgs(
    status_filter: Optional[str] = Query(None, alias="status"),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """List organisations with optional status filter."""
    stmt = select(Organization)
    count_stmt = select(func.count(Organization.id))

    if status_filter:
        stmt = stmt.where(Organization.status == status_filter)
        count_stmt = count_stmt.where(Organization.status == status_filter)

    total = (await session.execute(count_stmt)).scalar_one()
    query = stmt.offset(offset).limit(limit).order_by(Organization.created_at.desc())
    rows = (await session.execute(query)).scalars().all()

    return {"items": list(rows), "total": total}


# ---------- GET ----------


@router.get("/{org_id}", response_model=OrgResponse)
async def get_org(org_id: str, session: AsyncSession = Depends(get_session)) -> Organization:
    """Get organisation details."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return org


# ---------- UPDATE ----------


@router.patch("/{org_id}", response_model=OrgResponse)
async def update_org(
    org_id: str,
    body: OrgUpdateRequest,
    session: AsyncSession = Depends(get_session),
) -> Organization:
    """Update organisation metadata."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")

    if body.display_name is not None:
        org.display_name = body.display_name
    if "max_budget" in body.model_fields_set:
        org.max_budget = body.max_budget
    org.updated_at = datetime.now(timezone.utc)

    await session.commit()
    return org


# ---------- DELETE ----------


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org(org_id: str, session: AsyncSession = Depends(get_session)) -> None:
    """Destroy org infrastructure and delete the record."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")

    org.status = OrgStatus.DELETING
    await session.commit()

    try:
        # 1. Destroy container
        if org.container_id:
            orchestrator = get_orchestrator()
            await orchestrator.destroy_instance(org.container_id)

        # 2. Drop DB schema
        await drop_org_schema(org.pg_schema)

    except Exception as exc:
        logger.exception("Error during org deletion: %s", exc)
        org.status = OrgStatus.ERROR
        org.error_message = f"Deletion failed: {exc}"
        await session.commit()
        raise HTTPException(status_code=500, detail=f"Deletion failed: {exc}")

    await session.delete(org)
    await session.commit()


# ---------- ACTIONS ----------


@router.post("/{org_id}/stop", response_model=OrgResponse)
async def stop_org(org_id: str, session: AsyncSession = Depends(get_session)) -> Organization:
    """Stop (scale-to-zero) an org's LiteLLM instance."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if not org.container_id:
        raise HTTPException(status_code=400, detail="No container to stop")

    orchestrator = get_orchestrator()
    await orchestrator.stop_instance(org.container_id)
    org.status = OrgStatus.SUSPENDED
    org.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return org


@router.post("/{org_id}/start", response_model=OrgResponse)
async def start_org(org_id: str, session: AsyncSession = Depends(get_session)) -> Organization:
    """Wake a suspended org's LiteLLM instance."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if not org.container_id:
        raise HTTPException(status_code=400, detail="No container to start")

    orchestrator = get_orchestrator()
    info = await orchestrator.start_instance(org.container_id)
    org.container_url = info.url
    org.litellm_port = info.port
    org.status = OrgStatus.ACTIVE
    org.updated_at = datetime.now(timezone.utc)
    await session.commit()
    return org


@router.get("/{org_id}/status")
async def org_instance_status(org_id: str, session: AsyncSession = Depends(get_session)) -> dict:
    """Check the container status of an org's LiteLLM instance."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    if not org.container_id:
        return {"org_id": org_id, "container_status": "none"}

    orchestrator = get_orchestrator()
    container_status = await orchestrator.get_instance_status(org.container_id)
    return {"org_id": org_id, "container_status": container_status}

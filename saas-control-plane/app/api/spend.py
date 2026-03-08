"""Cost tracking: sync spend data from LiteLLM instances."""

import json
import logging
from datetime import date, datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_current_user, require_admin
from app.db.models import Organization, OrgStatus, SpendLog, User
from app.db.session import get_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["cost-tracking"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SpendSyncResult(BaseModel):
    org_id: str
    org_slug: str
    current_spend: float
    synced: bool
    error: str | None = None


class BulkSyncResponse(BaseModel):
    results: list[SpendSyncResult]
    total_synced: int
    total_errors: int


class SpendLogResponse(BaseModel):
    id: int
    org_id: str
    date: str
    total_spend: float
    model_spend: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class OrgSpendResponse(BaseModel):
    org_id: str
    org_slug: str
    current_spend: float
    max_budget: float | None
    budget_remaining: float | None
    spend_history: list[SpendLogResponse]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _sync_org_spend(org: Organization, session: AsyncSession) -> SpendSyncResult:
    """Fetch spend from a single org's LiteLLM instance and update records."""
    if not org.container_url or org.status != OrgStatus.ACTIVE:
        return SpendSyncResult(
            org_id=org.id,
            org_slug=org.slug,
            current_spend=org.current_spend,
            synced=False,
            error="Instance not active",
        )

    # LiteLLM spend endpoint: GET /global/spend with master key
    url = f"{org.container_url}/global/spend"
    headers = {"Authorization": f"Bearer {org.master_key}"}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, headers=headers)

        if resp.status_code != 200:
            return SpendSyncResult(
                org_id=org.id,
                org_slug=org.slug,
                current_spend=org.current_spend,
                synced=False,
                error=f"LiteLLM returned {resp.status_code}",
            )

        data = resp.json()
        # LiteLLM /global/spend returns [{"total_spend": float}]
        # or {"total_spend": float} depending on version
        total_spend: float = 0.0
        if isinstance(data, list) and len(data) > 0:
            total_spend = float(data[0].get("total_spend", 0.0))
        elif isinstance(data, dict):
            total_spend = float(data.get("total_spend", 0.0))

        # Update current_spend on the org
        org.current_spend = total_spend
        org.updated_at = datetime.now(timezone.utc)

        # Upsert today's spend log
        today_str = date.today().isoformat()
        existing_log = (
            await session.execute(
                select(SpendLog).where(SpendLog.org_id == org.id, SpendLog.date == today_str)
            )
        ).scalar_one_or_none()

        if existing_log:
            existing_log.total_spend = total_spend
        else:
            session.add(
                SpendLog(
                    org_id=org.id,
                    date=today_str,
                    total_spend=total_spend,
                )
            )

        await session.commit()

        return SpendSyncResult(
            org_id=org.id,
            org_slug=org.slug,
            current_spend=total_spend,
            synced=True,
        )

    except httpx.HTTPError as exc:
        logger.warning("Failed to sync spend for org %s: %s", org.slug, exc)
        return SpendSyncResult(
            org_id=org.id,
            org_slug=org.slug,
            current_spend=org.current_spend,
            synced=False,
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/orgs/{org_id}/sync-spend", response_model=SpendSyncResult)
async def sync_org_spend(
    org_id: str,
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> SpendSyncResult:
    """Trigger a spend sync for a single organisation."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return await _sync_org_spend(org, session)


@router.post("/admin/sync-all-spend", response_model=BulkSyncResponse)
async def sync_all_spend(
    _admin: User = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Trigger a spend sync for all active organisations."""
    rows = (
        await session.execute(select(Organization).where(Organization.status == OrgStatus.ACTIVE))
    ).scalars().all()

    results: list[SpendSyncResult] = []
    for org in rows:
        result = await _sync_org_spend(org, session)
        results.append(result)

    synced = sum(1 for r in results if r.synced)
    errors = sum(1 for r in results if not r.synced)
    return {"results": results, "total_synced": synced, "total_errors": errors}


@router.get("/orgs/{org_id}/spend", response_model=OrgSpendResponse)
async def get_org_spend(
    org_id: str,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Get spend details and history for an organisation."""
    org = await session.get(Organization, org_id)
    if org is None:
        raise HTTPException(status_code=404, detail="Organisation not found")

    logs = (
        await session.execute(
            select(SpendLog)
            .where(SpendLog.org_id == org_id)
            .order_by(SpendLog.date.desc())
            .limit(90)
        )
    ).scalars().all()

    # Parse model_spend JSON for each log
    history = []
    for log in logs:
        model_spend = None
        if log.model_spend:
            try:
                model_spend = json.loads(log.model_spend)
            except (json.JSONDecodeError, TypeError):
                pass
        history.append(
            SpendLogResponse(
                id=log.id,
                org_id=log.org_id,
                date=log.date,
                total_spend=log.total_spend,
                model_spend=model_spend,
                created_at=log.created_at,
            )
        )

    budget_remaining = None
    if org.max_budget is not None:
        budget_remaining = max(0.0, org.max_budget - org.current_spend)

    return {
        "org_id": org.id,
        "org_slug": org.slug,
        "current_spend": org.current_spend,
        "max_budget": org.max_budget,
        "budget_remaining": budget_remaining,
        "spend_history": history,
    }

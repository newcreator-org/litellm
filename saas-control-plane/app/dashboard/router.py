"""Dashboard routes — server-side rendered HTML pages."""

import logging
from datetime import datetime, timezone
from pathlib import Path

import jwt
from fastapi import APIRouter, Cookie, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.spend import _sync_org_spend
from app.core.auth import create_access_token, decode_token, generate_user_id, hash_password, verify_password
from app.core.config import settings
from app.db.models import Organization, OrgStatus, SpendLog, User, UserRole
from app.db.session import get_session
from app.orchestrator.factory import get_orchestrator

logger = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATE_DIR))

router = APIRouter(prefix="/dashboard", tags=["dashboard"], include_in_schema=False)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_user_from_cookie(
    access_token: str | None = Cookie(None),
    session: AsyncSession = Depends(get_session),
) -> User | None:
    """Return the user from the JWT cookie, or None if not logged in."""
    if not access_token:
        return None
    try:
        payload = decode_token(access_token)
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        return None
    return user


# ---------------------------------------------------------------------------
# Auth pages
# ---------------------------------------------------------------------------


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: str = "") -> HTMLResponse:
    return templates.TemplateResponse("login.html", {"request": request, "error": error, "user": None})


@router.post("/login", response_class=HTMLResponse)
async def login_submit(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse | RedirectResponse:
    result = await session.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(password, user.hashed_password):
        ctx = {"request": request, "error": "Invalid email or password", "user": None}
        return templates.TemplateResponse("login.html", ctx)

    if not user.is_active:
        ctx = {"request": request, "error": "Account is disabled", "user": None}
        return templates.TemplateResponse("login.html", ctx)

    token = create_access_token(user.id, user.role.value)
    response = RedirectResponse(url="/dashboard/", status_code=303)
    response.set_cookie("access_token", token, httponly=True, samesite="lax", max_age=settings.jwt_expire_minutes * 60)
    return response


@router.get("/register", response_class=HTMLResponse)
async def register_page(request: Request, error: str = "") -> HTMLResponse:
    return templates.TemplateResponse("register.html", {"request": request, "error": error, "user": None})


@router.post("/register", response_class=HTMLResponse)
async def register_submit(
    request: Request,
    display_name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse | RedirectResponse:
    if len(password) < 8:
        ctx = {"request": request, "error": "Password must be at least 8 characters", "user": None}
        return templates.TemplateResponse("register.html", ctx)

    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none() is not None:
        ctx = {"request": request, "error": "Email already registered", "user": None}
        return templates.TemplateResponse("register.html", ctx)

    user_count = (await session.execute(select(func.count(User.id)))).scalar_one()
    role = UserRole.ADMIN if user_count == 0 else UserRole.VIEWER

    user = User(
        id=generate_user_id(),
        email=email,
        hashed_password=hash_password(password),
        display_name=display_name,
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    session.add(user)
    await session.commit()

    token = create_access_token(user.id, user.role.value)
    response = RedirectResponse(url="/dashboard/", status_code=303)
    response.set_cookie("access_token", token, httponly=True, samesite="lax", max_age=settings.jwt_expire_minutes * 60)
    return response


@router.get("/logout")
async def logout() -> RedirectResponse:
    response = RedirectResponse(url="/dashboard/login", status_code=303)
    response.delete_cookie("access_token")
    return response


# ---------------------------------------------------------------------------
# Main dashboard pages
# ---------------------------------------------------------------------------


@router.get("/", response_class=HTMLResponse)
async def dashboard_home(
    request: Request,
    status: str = "",
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse | RedirectResponse:
    if not user:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    stmt = select(Organization)
    if status:
        stmt = stmt.where(Organization.status == status)
    orgs = (await session.execute(stmt.order_by(Organization.created_at.desc()))).scalars().all()

    total = len(orgs) if status else (await session.execute(select(func.count(Organization.id)))).scalar_one()
    active_count = sum(1 for o in orgs if o.status == OrgStatus.ACTIVE) if status else (
        await session.execute(select(func.count(Organization.id)).where(Organization.status == OrgStatus.ACTIVE))
    ).scalar_one()
    total_spend = sum(o.current_spend for o in orgs)
    budgets = [o.max_budget for o in orgs if o.max_budget is not None]
    total_budget = sum(budgets) if budgets else None

    return templates.TemplateResponse("orgs.html", {
        "request": request,
        "user": user,
        "orgs": orgs,
        "total": total,
        "active_count": active_count,
        "total_spend": total_spend,
        "total_budget": total_budget,
        "status_filter": status,
        "flash_message": None,
        "flash_type": None,
    })


@router.get("/orgs/{org_id}", response_class=HTMLResponse)
async def org_detail(
    request: Request,
    org_id: str,
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> HTMLResponse | RedirectResponse:
    if not user:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    org = await session.get(Organization, org_id)
    if org is None:
        return RedirectResponse(url="/dashboard/", status_code=303)

    spend_history = (
        await session.execute(
            select(SpendLog).where(SpendLog.org_id == org_id).order_by(SpendLog.date.desc()).limit(30)
        )
    ).scalars().all()

    return templates.TemplateResponse("org_detail.html", {
        "request": request,
        "user": user,
        "org": org,
        "spend_history": spend_history,
        "flash_message": None,
        "flash_type": None,
    })


# ---------------------------------------------------------------------------
# Dashboard actions (POST forms)
# ---------------------------------------------------------------------------


@router.post("/orgs/{org_id}/sync-spend")
async def dashboard_sync_spend(
    org_id: str,
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    if not user or user.role != UserRole.ADMIN:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    org = await session.get(Organization, org_id)
    if org:
        await _sync_org_spend(org, session)

    return RedirectResponse(url=f"/dashboard/orgs/{org_id}", status_code=303)


@router.post("/sync-all-spend")
async def dashboard_sync_all_spend(
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    if not user or user.role != UserRole.ADMIN:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    orgs = (
        await session.execute(select(Organization).where(Organization.status == OrgStatus.ACTIVE))
    ).scalars().all()

    for org in orgs:
        await _sync_org_spend(org, session)

    return RedirectResponse(url="/dashboard/", status_code=303)


@router.post("/orgs/{org_id}/stop")
async def dashboard_stop_org(
    org_id: str,
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    if not user or user.role != UserRole.ADMIN:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    org = await session.get(Organization, org_id)
    if org and org.container_id:
        orchestrator = get_orchestrator()
        await orchestrator.stop_instance(org.container_id)
        org.status = OrgStatus.SUSPENDED
        org.updated_at = datetime.now(timezone.utc)
        await session.commit()

    return RedirectResponse(url=f"/dashboard/orgs/{org_id}", status_code=303)


@router.post("/orgs/{org_id}/start")
async def dashboard_start_org(
    org_id: str,
    user: User | None = Depends(_get_user_from_cookie),
    session: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    if not user or user.role != UserRole.ADMIN:
        return RedirectResponse(url="/dashboard/login", status_code=303)

    org = await session.get(Organization, org_id)
    if org and org.container_id:
        orchestrator = get_orchestrator()
        info = await orchestrator.start_instance(org.container_id)
        org.container_url = info.url
        org.litellm_port = info.port
        org.status = OrgStatus.ACTIVE
        org.updated_at = datetime.now(timezone.utc)
        await session.commit()

    return RedirectResponse(url=f"/dashboard/orgs/{org_id}", status_code=303)

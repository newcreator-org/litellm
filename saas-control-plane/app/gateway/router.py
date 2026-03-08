"""API Gateway that routes incoming LLM requests to the correct org's LiteLLM instance.

Org resolution order:
1. ``X-Org-Slug`` header
2. ``x-org-id`` header (looks up slug from DB)
3. First subdomain segment (e.g. ``acme.llm.example.com`` -> ``acme``)
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Organization, OrgStatus
from app.db.session import get_session
from app.orchestrator.factory import get_orchestrator

logger = logging.getLogger(__name__)

router = APIRouter(tags=["gateway"])

# Paths that should NOT be proxied (control-plane management)
_RESERVED_PREFIXES = ("/orgs", "/health", "/docs", "/openapi.json", "/redoc")


async def _resolve_org(request: Request, session: AsyncSession) -> Organization:
    """Determine which org this request is for."""

    # 1. Explicit header
    slug = request.headers.get("X-Org-Slug")

    # 2. Org-id header -> look up slug
    if not slug:
        org_id = request.headers.get("X-Org-Id")
        if org_id:
            org = await session.get(Organization, org_id)
            if org is None:
                raise HTTPException(status_code=404, detail=f"Organisation {org_id} not found")
            return org

    # 3. Subdomain
    if not slug:
        host = request.headers.get("host", "")
        parts = host.split(".")
        if len(parts) >= 3:
            slug = parts[0]

    if not slug:
        raise HTTPException(
            status_code=400,
            detail="Cannot determine organisation. Set X-Org-Slug header or use subdomain routing.",
        )

    result = await session.execute(select(Organization).where(Organization.slug == slug))
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(status_code=404, detail=f"Organisation '{slug}' not found")
    return org


@router.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
)
async def proxy_to_litellm(
    request: Request,
    path: str,
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Reverse-proxy all non-management requests to the org's LiteLLM instance."""

    # Skip reserved paths (handled by other routers)
    for prefix in _RESERVED_PREFIXES:
        if f"/{path}".startswith(prefix):
            raise HTTPException(status_code=404, detail="Not a gateway path")

    org = await _resolve_org(request, session)

    # Ensure instance is running
    if org.status == OrgStatus.SUSPENDED and org.container_id:
        logger.info("Waking suspended org %s", org.slug)
        orchestrator = get_orchestrator()
        info = await orchestrator.start_instance(org.container_id)
        org.container_url = info.url
        org.litellm_port = info.port
        org.status = OrgStatus.ACTIVE
        await session.commit()

    if org.status != OrgStatus.ACTIVE or not org.container_url:
        raise HTTPException(
            status_code=503,
            detail=f"Organisation '{org.slug}' instance is not available (status={org.status})",
        )

    # Build upstream URL
    upstream = f"{org.container_url}/{path}"
    if request.url.query:
        upstream += f"?{request.url.query}"

    # Forward headers (strip gateway-specific ones)
    fwd_headers = dict(request.headers)
    for h in ("host", "x-org-slug", "x-org-id"):
        fwd_headers.pop(h, None)

    body = await request.body()

    # Use a persistent client for the streaming context
    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    try:
        resp = await client.send(
            client.build_request(
                method=request.method,
                url=upstream,
                headers=fwd_headers,
                content=body,
            ),
            stream=True,
        )
    except httpx.ConnectError:
        await client.aclose()
        msg = f"Cannot connect to org '{org.slug}' instance at {org.container_url}"
        raise HTTPException(status_code=502, detail=msg)
    except httpx.ReadTimeout:
        await client.aclose()
        raise HTTPException(status_code=504, detail=f"Org '{org.slug}' instance timed out")

    excluded_headers = {"content-encoding", "transfer-encoding", "content-length"}
    response_headers = {k: v for k, v in resp.headers.items() if k.lower() not in excluded_headers}

    async def stream_response():
        try:
            async for chunk in resp.aiter_bytes():
                yield chunk
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(
        content=stream_response(),
        status_code=resp.status_code,
        headers=response_headers,
        media_type=resp.headers.get("content-type"),
    )

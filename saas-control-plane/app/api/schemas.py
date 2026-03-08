"""Pydantic request/response schemas for the control plane API."""

from datetime import datetime

from pydantic import BaseModel, Field


class OrgCreateRequest(BaseModel):
    """Request body for creating a new organisation."""

    slug: str = Field(
        ...,
        min_length=2,
        max_length=64,
        pattern=r"^[a-z0-9][a-z0-9\-]*[a-z0-9]$",
        description="URL-safe slug (lowercase, hyphens). Used for DB schema and routing.",
    )
    display_name: str = Field(..., min_length=1, max_length=256)
    max_budget: float | None = Field(None, ge=0, description="Optional monthly budget cap in USD")
    master_key: str | None = Field(
        None,
        description="Custom LiteLLM master key. If omitted, one is auto-generated.",
    )
    env_extra: dict[str, str] | None = Field(
        None,
        description="Extra environment variables to pass to the LiteLLM instance.",
    )


class OrgUpdateRequest(BaseModel):
    """Request body for updating an organisation."""

    display_name: str | None = Field(None, min_length=1, max_length=256)
    max_budget: float | None = Field(None, ge=0)
    env_extra: dict[str, str] | None = None


class OrgResponse(BaseModel):
    """Public representation of an organisation."""

    id: str
    slug: str
    display_name: str
    status: str
    container_url: str | None
    litellm_port: int | None
    master_key: str
    max_budget: float | None
    current_spend: float
    created_at: datetime
    updated_at: datetime
    error_message: str | None = None

    model_config = {"from_attributes": True}


class OrgListResponse(BaseModel):
    """Paginated list of organisations."""

    items: list[OrgResponse]
    total: int


class HealthResponse(BaseModel):
    """Health check response."""

    status: str
    version: str = "0.1.0"
    orchestrator: str

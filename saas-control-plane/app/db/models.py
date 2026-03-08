"""SQLAlchemy models for the control-plane database."""

import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class OrgStatus(str, enum.Enum):
    """Lifecycle status of an organisation."""

    PROVISIONING = "provisioning"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DELETING = "deleting"
    DELETED = "deleted"
    ERROR = "error"


class Organization(Base):
    """Each row represents one tenant / customer organisation."""

    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    slug: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[OrgStatus] = mapped_column(
        Enum(OrgStatus, name="org_status", native_enum=False),
        default=OrgStatus.PROVISIONING,
        nullable=False,
    )

    # Infrastructure references
    pg_schema: Mapped[str] = mapped_column(String(128), nullable=False)
    redis_prefix: Mapped[str] = mapped_column(String(128), nullable=False)
    container_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    container_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    litellm_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # LiteLLM master key for this org's instance
    master_key: Mapped[str] = mapped_column(String(256), nullable=False)

    # Cost / metering
    max_budget: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_spend: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

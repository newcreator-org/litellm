"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Control plane configuration."""

    # Control plane DB (manages org metadata)
    database_url: str = "postgresql+asyncpg://llmproxy:dbpassword9090@localhost:5432/litellm_control_plane"

    # Shared PostgreSQL for org schemas (raw connection for DDL)
    shared_pg_host: str = "localhost"
    shared_pg_port: int = 5432
    shared_pg_user: str = "llmproxy"
    shared_pg_password: str = "dbpassword9090"
    shared_pg_database: str = "litellm_saas"

    # Shared Redis
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""

    # LiteLLM image
    litellm_image: str = "ghcr.io/berriai/litellm:main-stable"
    litellm_internal_port: int = 4000

    # Orchestrator backend: "docker" or "flyio"
    orchestrator_backend: str = "docker"

    # Fly.io settings (only when orchestrator_backend == "flyio")
    fly_api_token: str = ""
    fly_org: str = "personal"
    fly_region: str = "nrt"  # Tokyo

    # Gateway
    gateway_port: int = 8000

    # Control plane
    control_plane_api_key: str = "sk-cp-secret"  # protect management API

    # JWT authentication
    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 hours

    model_config = {"env_prefix": "CP_", "env_file": ".env", "extra": "ignore"}


settings = Settings()

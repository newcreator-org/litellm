"""Abstract interface for container orchestration backends."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class ContainerInfo:
    """Information about a running LiteLLM container."""

    container_id: str
    url: str  # Internal URL to reach the container
    port: int
    status: str  # "running", "stopped", "error"


@dataclass
class ContainerConfig:
    """Configuration needed to start a LiteLLM container."""

    org_id: str
    org_slug: str
    image: str
    database_url: str
    redis_host: str
    redis_port: int
    redis_password: str
    redis_prefix: str
    master_key: str
    env_extra: dict[str, str] | None = None


class OrchestratorBackend(ABC):
    """Abstract base for container orchestrators."""

    @abstractmethod
    async def create_instance(self, config: ContainerConfig) -> ContainerInfo:
        """Provision and start a new LiteLLM container for an org."""

    @abstractmethod
    async def destroy_instance(self, container_id: str) -> None:
        """Stop and remove a LiteLLM container."""

    @abstractmethod
    async def get_instance_status(self, container_id: str) -> str:
        """Return current status of a container: running, stopped, error."""

    @abstractmethod
    async def start_instance(self, container_id: str) -> ContainerInfo:
        """Start a stopped container (wake from scale-to-zero)."""

    @abstractmethod
    async def stop_instance(self, container_id: str) -> None:
        """Stop a running container (scale-to-zero)."""

    @abstractmethod
    async def list_instances(self) -> list[ContainerInfo]:
        """List all managed LiteLLM containers."""

"""Factory to create the appropriate orchestrator backend."""

from app.core.config import settings
from app.orchestrator.base import OrchestratorBackend


def get_orchestrator() -> OrchestratorBackend:
    """Return an orchestrator based on the CP_ORCHESTRATOR_BACKEND setting."""
    backend = settings.orchestrator_backend.lower()

    if backend == "docker":
        from app.orchestrator.docker_backend import DockerBackend

        return DockerBackend()
    elif backend == "flyio":
        from app.orchestrator.flyio_backend import FlyioBackend

        return FlyioBackend()
    else:
        raise ValueError(f"Unknown orchestrator backend: {backend!r}. Use 'docker' or 'flyio'.")

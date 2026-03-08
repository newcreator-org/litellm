"""Fly.io Machines-based orchestrator for production.

Uses the Fly.io Machines REST API to create/manage per-org LiteLLM
containers with auto-stop (scale-to-zero) enabled.

Docs: https://fly.io/docs/machines/api/
"""

import logging
from typing import Any

import httpx

from app.core.config import settings
from app.orchestrator.base import ContainerConfig, ContainerInfo, OrchestratorBackend

logger = logging.getLogger(__name__)

_FLY_API = "https://api.machines.dev"


class FlyioBackend(OrchestratorBackend):
    """Manage LiteLLM containers on Fly.io Machines."""

    def __init__(self) -> None:
        self._token = settings.fly_api_token
        self._org = settings.fly_org
        self._region = settings.fly_region

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def _app_name(self, org_slug: str) -> str:
        """Fly app name for a given org."""
        return f"litellm-{org_slug}"

    # ---------- internal ----------

    async def _api(self, method: str, path: str, json_body: dict[str, Any] | None = None) -> dict[str, Any] | list[Any]:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.request(method, f"{_FLY_API}{path}", headers=self._headers, json=json_body)
            if resp.status_code >= 400:
                logger.error("Fly API error %s %s: %s %s", method, path, resp.status_code, resp.text)
                resp.raise_for_status()
            if resp.status_code == 204 or not resp.content:
                return {}
            return resp.json()  # type: ignore[no-any-return]

    async def _ensure_app(self, app_name: str) -> None:
        """Create the Fly app if it doesn't exist."""
        try:
            await self._api("GET", f"/v1/apps/{app_name}")
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                await self._api(
                    "POST",
                    "/v1/apps",
                    {"app_name": app_name, "org_slug": self._org},
                )
                logger.info("Created Fly app: %s", app_name)
            else:
                raise

    # ---------- interface ----------

    async def create_instance(self, config: ContainerConfig) -> ContainerInfo:
        app_name = self._app_name(config.org_slug)
        await self._ensure_app(app_name)

        env_vars: dict[str, str] = {
            "DATABASE_URL": config.database_url,
            "REDIS_HOST": config.redis_host,
            "REDIS_PORT": str(config.redis_port),
            "REDIS_PASSWORD": config.redis_password,
            "LITELLM_MASTER_KEY": config.master_key,
            "STORE_MODEL_IN_DB": "True",
            "LITELLM_LOG": "INFO",
        }
        if config.redis_prefix:
            env_vars["REDIS_NAMESPACE"] = config.redis_prefix
        if config.env_extra:
            _PROTECTED_ENV_KEYS = {
                "DATABASE_URL", "REDIS_HOST", "REDIS_PORT", "REDIS_PASSWORD",
                "REDIS_NAMESPACE", "LITELLM_MASTER_KEY", "STORE_MODEL_IN_DB",
            }
            safe_extra = {k: v for k, v in config.env_extra.items() if k not in _PROTECTED_ENV_KEYS}
            env_vars.update(safe_extra)

        machine_config: dict[str, Any] = {
            "name": f"litellm-{config.org_slug}",
            "region": self._region,
            "config": {
                "image": config.image,
                "env": env_vars,
                "services": [
                    {
                        "ports": [
                            {"port": 443, "handlers": ["tls", "http"]},
                            {"port": 80, "handlers": ["http"]},
                        ],
                        "protocol": "tcp",
                        "internal_port": settings.litellm_internal_port,
                        "concurrency": {"type": "requests", "hard_limit": 250, "soft_limit": 200},
                    }
                ],
                "auto_destroy": False,
                # Scale-to-zero: stop machine after 5 min idle
                "restart": {"policy": "on-failure", "max_retries": 3},
            },
        }

        data = await self._api("POST", f"/v1/apps/{app_name}/machines", machine_config)
        machine_id: str = data["id"]
        url = f"https://{app_name}.fly.dev"

        logger.info("Created Fly machine %s for org %s at %s", machine_id, config.org_slug, url)

        # Enable auto-stop
        try:
            await self._api(
                "POST",
                f"/v1/apps/{app_name}/machines/{machine_id}/metadata/fly_platform_autostop",
                {"value": "stop"},
            )
        except Exception:
            logger.warning("Failed to set auto-stop for machine %s; continuing", machine_id)

        return ContainerInfo(
            container_id=machine_id,
            url=url,
            port=443,
            status="running",
        )

    async def destroy_instance(self, container_id: str) -> None:
        # We need app_name; container_id alone isn't enough.
        # List apps and find which one owns this machine.
        instances = await self.list_instances()
        for inst in instances:
            if inst.container_id == container_id:
                app_name = inst.url.replace("https://", "").replace(".fly.dev", "")
                await self._api("DELETE", f"/v1/apps/{app_name}/machines/{container_id}?force=true")
                logger.info("Destroyed Fly machine %s in app %s", container_id, app_name)
                return
        raise RuntimeError(f"Machine {container_id} not found")

    async def get_instance_status(self, container_id: str) -> str:
        # Iterate through apps to find the machine
        instances = await self.list_instances()
        for inst in instances:
            if inst.container_id == container_id:
                return inst.status
        return "error"

    async def start_instance(self, container_id: str) -> ContainerInfo:
        instances = await self.list_instances()
        for inst in instances:
            if inst.container_id == container_id:
                app_name = inst.url.replace("https://", "").replace(".fly.dev", "")
                await self._api("POST", f"/v1/apps/{app_name}/machines/{container_id}/start")
                inst.status = "running"
                return inst
        raise RuntimeError(f"Machine {container_id} not found")

    async def stop_instance(self, container_id: str) -> None:
        instances = await self.list_instances()
        for inst in instances:
            if inst.container_id == container_id:
                app_name = inst.url.replace("https://", "").replace(".fly.dev", "")
                await self._api("POST", f"/v1/apps/{app_name}/machines/{container_id}/stop")
                return
        raise RuntimeError(f"Machine {container_id} not found")

    async def list_instances(self) -> list[ContainerInfo]:
        """List all litellm-* apps and their machines."""
        apps_data = await self._api("GET", f"/v1/apps?org_slug={self._org}")
        results: list[ContainerInfo] = []

        for app in apps_data.get("apps", []):
            app_name: str = app.get("name", "")
            if not app_name.startswith("litellm-"):
                continue

            try:
                machines_data = await self._api("GET", f"/v1/apps/{app_name}/machines")
            except Exception:
                continue

            for machine in machines_data if isinstance(machines_data, list) else []:
                results.append(
                    ContainerInfo(
                        container_id=machine["id"],
                        url=f"https://{app_name}.fly.dev",
                        port=443,
                        status=machine.get("state", "unknown"),
                    )
                )
        return results

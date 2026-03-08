"""Docker-based orchestrator for local development.

Uses `docker run` / `docker stop` / `docker rm` via subprocess so we don't
need the Docker SDK as a hard dependency.
"""

import asyncio
import json
import logging

from app.core.config import settings
from app.orchestrator.base import ContainerConfig, ContainerInfo, OrchestratorBackend

logger = logging.getLogger(__name__)

_LABEL = "litellm-saas-org"


class DockerBackend(OrchestratorBackend):
    """Manage LiteLLM containers via the local Docker daemon."""

    # ---------- helpers ----------

    @staticmethod
    async def _run(cmd: list[str]) -> tuple[int, str, str]:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout_b, stderr_b = await proc.communicate()
        return proc.returncode or 0, stdout_b.decode().strip(), stderr_b.decode().strip()

    @staticmethod
    def _container_name(org_slug: str) -> str:
        return f"litellm-org-{org_slug}"

    # Find next available port starting from a base
    _next_port: int = 4100

    async def _allocate_port(self) -> int:
        """Find the next free host port by checking existing containers."""
        rc, out, _ = await self._run(
            [
                "docker",
                "ps",
                "-a",
                "--filter",
                f"label={_LABEL}",
                "--format",
                "{{.Ports}}",
            ]
        )
        used_ports: set[int] = set()
        if rc == 0 and out:
            for line in out.splitlines():
                # e.g. "0.0.0.0:4101->4000/tcp"
                for part in line.split(","):
                    part = part.strip()
                    if "->" in part:
                        host_part = part.split("->")[0]
                        port_str = host_part.rsplit(":", 1)[-1]
                        if port_str.isdigit():
                            used_ports.add(int(port_str))

        port = DockerBackend._next_port
        while port in used_ports:
            port += 1
        DockerBackend._next_port = port + 1
        return port

    # ---------- interface ----------

    async def create_instance(self, config: ContainerConfig) -> ContainerInfo:
        name = self._container_name(config.org_slug)
        port = await self._allocate_port()

        env_flags: list[str] = []
        env_vars = {
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

        for k, v in env_vars.items():
            env_flags += ["-e", f"{k}={v}"]

        cmd = [
            "docker",
            "run",
            "-d",
            "--name",
            name,
            "--label",
            f"{_LABEL}={config.org_id}",
            "--network",
            "litellm-saas-net",
            "-p",
            f"{port}:{settings.litellm_internal_port}",
            *env_flags,
            config.image,
        ]

        logger.info("Starting container %s on port %d", name, port)
        rc, out, err = await self._run(cmd)
        if rc != 0:
            raise RuntimeError(f"docker run failed: {err}")

        container_id = out[:12]
        url = f"http://{name}:{settings.litellm_internal_port}"

        return ContainerInfo(
            container_id=container_id,
            url=url,
            port=port,
            status="running",
        )

    async def destroy_instance(self, container_id: str) -> None:
        await self._run(["docker", "rm", "-f", container_id])

    async def get_instance_status(self, container_id: str) -> str:
        rc, out, _ = await self._run(
            ["docker", "inspect", "--format", "{{.State.Status}}", container_id]
        )
        if rc != 0:
            return "error"
        return out  # "running", "exited", etc.

    async def start_instance(self, container_id: str) -> ContainerInfo:
        rc, _, err = await self._run(["docker", "start", container_id])
        if rc != 0:
            raise RuntimeError(f"docker start failed: {err}")

        # Get port and URL from inspect
        rc2, out2, _ = await self._run(
            ["docker", "inspect", container_id]
        )
        if rc2 != 0:
            raise RuntimeError("Failed to inspect container after start")

        info = json.loads(out2)
        port_bindings = info[0].get("HostConfig", {}).get("PortBindings", {})
        port = settings.litellm_internal_port
        for _key, bindings in port_bindings.items():
            if bindings:
                port = int(bindings[0].get("HostPort", port))
                break

        # Resolve container name for Docker network URL
        rc3, name_out, _ = await self._run(
            ["docker", "inspect", "--format", "{{.Name}}", container_id]
        )
        cname = name_out.lstrip("/") if rc3 == 0 and name_out else container_id
        return ContainerInfo(
            container_id=container_id,
            url=f"http://{cname}:{settings.litellm_internal_port}",
            port=port,
            status="running",
        )

    async def stop_instance(self, container_id: str) -> None:
        await self._run(["docker", "stop", container_id])

    async def list_instances(self) -> list[ContainerInfo]:
        rc, out, _ = await self._run(
            [
                "docker",
                "ps",
                "-a",
                "--filter",
                f"label={_LABEL}",
                "--format",
                '{"id":"{{.ID}}","status":"{{.State}}","ports":"{{.Ports}}","names":"{{.Names}}"}',
            ]
        )
        results: list[ContainerInfo] = []
        if rc != 0 or not out:
            return results

        for line in out.splitlines():
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue

            port = 0
            ports_str: str = data.get("ports", "")
            if "->" in ports_str:
                host_part = ports_str.split("->")[0]
                port_str = host_part.rsplit(":", 1)[-1]
                if port_str.isdigit():
                    port = int(port_str)

            cname = data.get("names", data["id"])
            results.append(
                ContainerInfo(
                    container_id=data["id"],
                    url=f"http://{cname}:{settings.litellm_internal_port}" if cname else "",
                    port=port,
                    status=data.get("status", "unknown"),
                )
            )
        return results

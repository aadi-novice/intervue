"""Local dev / single-server launcher: one Docker container per meeting."""

from app.core.config import settings
from app.worker.bot_launchers.base import BotSpec


class DockerLauncher:
    name = "docker"

    def _client(self):
        import docker

        return docker.from_env()

    def launch(self, spec: BotSpec) -> str:
        kwargs: dict = dict(
            image=settings.bot_image,
            name=f"intervue-bot-{spec.session_id}",
            environment=spec.env(),
            detach=True,
            auto_remove=False,
            mem_limit=settings.bot_docker_mem_limit,
            shm_size="1g",  # Chromium needs a real /dev/shm
            labels={"intervue.bot": "1", "intervue.session": str(spec.session_id)},
        )
        if settings.bot_docker_network:
            kwargs["network"] = settings.bot_docker_network
        if settings.bot_docker_extra_hosts:
            kwargs["extra_hosts"] = {"host.docker.internal": "host-gateway"}
        container = self._client().containers.run(**kwargs)
        return container.id

    def stop(self, container_ref: str) -> None:
        try:
            self._client().containers.get(container_ref).stop(timeout=20)
        except Exception:
            pass

    def is_running(self, container_ref: str) -> bool | None:
        try:
            return self._client().containers.get(container_ref).status == "running"
        except Exception:
            return False

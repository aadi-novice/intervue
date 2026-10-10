from app.core.config import settings
from app.worker.bot_launchers.base import BotLauncher, BotSpec  # noqa: F401


def get_launcher() -> BotLauncher:
    """Vendor choice is config only (BOT_LAUNCHER)."""
    name = settings.bot_launcher
    if name == "docker":
        from app.worker.bot_launchers.docker_launcher import DockerLauncher

        return DockerLauncher()
    if name == "ecs":
        from app.worker.bot_launchers.ecs_launcher import EcsLauncher

        return EcsLauncher()
    if name == "pool":
        from app.worker.bot_launchers.pool_launcher import PoolLauncher

        return PoolLauncher()
    raise ValueError(f"Unknown BOT_LAUNCHER: {name}")

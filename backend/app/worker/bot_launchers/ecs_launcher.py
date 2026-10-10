"""AWS launcher: one Fargate task per meeting (scales to zero)."""

import boto3

from app.core.config import settings
from app.worker.bot_launchers.base import BotSpec


class EcsLauncher:
    name = "ecs"

    def _client(self):
        return boto3.client("ecs", region_name=settings.s3_region)

    def launch(self, spec: BotSpec) -> str:
        resp = self._client().run_task(
            cluster=settings.ecs_cluster,
            taskDefinition=settings.ecs_task_definition,
            launchType="FARGATE",
            count=1,
            networkConfiguration={
                "awsvpcConfiguration": {
                    "subnets": settings.ecs_subnets,
                    "securityGroups": settings.ecs_security_groups,
                    "assignPublicIp": "ENABLED",  # bots need outbound internet to join meetings
                }
            },
            overrides={
                "containerOverrides": [
                    {
                        "name": settings.ecs_container_name,
                        "environment": [{"name": k, "value": v} for k, v in spec.env().items()],
                    }
                ]
            },
            tags=[{"key": "intervue-session", "value": str(spec.session_id)}],
        )
        if resp.get("failures") or not resp.get("tasks"):
            raise RuntimeError(f"ECS RunTask failed: {resp.get('failures')}")
        return resp["tasks"][0]["taskArn"]

    def stop(self, container_ref: str) -> None:
        try:
            self._client().stop_task(
                cluster=settings.ecs_cluster, task=container_ref, reason="stopped by Intervue"
            )
        except Exception:
            pass

    def is_running(self, container_ref: str) -> bool | None:
        try:
            tasks = self._client().describe_tasks(
                cluster=settings.ecs_cluster, tasks=[container_ref]
            )["tasks"]
            return bool(tasks) and tasks[0]["lastStatus"] not in ("STOPPED", "DEPROVISIONING")
        except Exception:
            return None

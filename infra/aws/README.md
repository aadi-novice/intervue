# Intervue on AWS (Terraform skeleton)

Status: **not applied.** `terraform fmt` and `terraform validate` passed (run through the `hashicorp/terraform`
Docker image with `init -backend=false`); no plan or apply has been run against an account.

## What it creates
VPC (2 AZ, public + private subnets, one NAT, S3 gateway endpoint), ECR repos (frontend, backend, notetaker-bot,
transcriber), ECS cluster with Fargate services `frontend` (behind an ALB), `backend` (Cloud Map name
`backend.<name>.local:8000`, not public), `worker`, `beat` (exactly 1 task, no overlap on deploy), a bot task
definition (launched per meeting with `ecs:RunTask`, no service), RDS PostgreSQL 16 (Multi-AZ variable), ElastiCache
Redis 7 (TLS, so `rediss://`), private S3 bucket (Block Public Access, SSE-S3, versioning off, `exports/` expiry),
Secrets Manager entries, IAM roles, CloudWatch log groups, optional CloudFront, optional SES identity.
`transcriber.tf` holds the GPU (g4dn) capacity-provider + task definition, fully commented out.

IAM: the backend/worker/beat task role gets S3 access scoped to the bucket and `ecs:RunTask` on the bot task
definition. The **bot task role has no policies**: bots only use presigned URLs from the backend.

## Apply order
1. `cp terraform.tfvars.example terraform.tfvars`, set `bucket_name` (globally unique), domain, certificate.
   Configure a remote state backend in `versions.tf`.
2. `terraform init`, then create ECR first so images can be pushed:
   `terraform apply -target=aws_ecr_repository.repo`
3. Build and push images (tag = `var.image_tag`). The frontend bakes the backend address in at build time:
   ```
   docker build -t <ecr>/intervue/backend:latest backend
   docker build -t <ecr>/intervue/frontend:latest --build-arg BACKEND_INTERNAL_URL=http://backend.intervue.local:8000 frontend
   docker build -t <ecr>/intervue/notetaker-bot:latest services/notetaker-bot
   ```
4. `terraform apply` (everything else). Services stay unhealthy until secrets are set.
5. Set real secret values (each is a placeholder `CHANGE_ME`):
   `aws secretsmanager put-secret-value --secret-id intervue-prod/JWT_PRIVATE_KEY --secret-string file://jwt.key`
   then `aws ecs update-service --force-new-deployment` for backend, worker, beat.
6. The backend task runs `alembic upgrade head` on start (`RUN_MIGRATIONS=true`), which also runs
   `CREATE EXTENSION vector`. If you restore from another database, restore before first start (see docs/DEPLOYMENT.md).
7. Point DNS at the ALB (or CloudFront), set up SES DNS records.

## Intentionally left to fill in
- HTTPS: `acm_certificate_arn` and DNS records; CloudFront is optional and needs a us-east-1 certificate for a custom domain.
- SES: DNS verification, DKIM, production access request. SMTP-style variables are not wired (EMAIL_BACKEND=ses).
- Bot launcher env names (`ECS_CLUSTER`, `ECS_TASK_DEFINITION`, `ECS_SUBNETS`, `ECS_SECURITY_GROUPS` in `main.tf`) match `backend/app/core/config.py`; also set `INTERNAL_API_URL` to an address the bot tasks can reach
  once it exists; bots also need a callback URL they can reach (internal backend DNS works from the same VPC).
- Fargate does not honour `sharedMemorySize`; if Chromium crashes, add `--disable-dev-shm-usage` in the bot or run bots on EC2.
- Worker autoscaling on queue depth (needs a custom CloudWatch metric); one NAT gateway only; no WAF; no alarms.
- The GPU transcriber module (`transcriber.tf`) and a Cloud Map entry for it.
- OAuth client IDs, OpenAI key, Sentry DSN: set in Secrets Manager.
- The DB password lives in Terraform state (random_password); use an encrypted remote state backend.

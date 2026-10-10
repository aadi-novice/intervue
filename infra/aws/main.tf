data "aws_availability_zones" "available" {
  state = "available"
}
data "aws_caller_identity" "current" {}

locals {
  prefix = "${var.name}-${var.environment}"
  azs    = slice(data.aws_availability_zones.available.names, 0, 2)

  public_url = var.domain_name != "" ? "https://${var.domain_name}" : "http://${aws_lb.main.dns_name}"
  https      = var.acm_certificate_arn != ""

  # App secrets stored in Secrets Manager. Terraform creates placeholders; set the real values by hand
  # (aws secretsmanager put-secret-value) - ignore_changes keeps them out of subsequent applies.
  app_secret_keys = [
    "OPENAI_API_KEY", "JWT_PRIVATE_KEY", "JWT_PUBLIC_KEY", "TOKEN_ENCRYPTION_KEY", "INTERNAL_HMAC_SECRET",
    "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET",
    "TRANSCRIBER_API_KEY", "TRANSCRIBER_CALLBACK_SECRET", "SENTRY_DSN",
  ]

  # Non-secret env shared by backend, worker, beat.
  backend_env = [
    { name = "ENVIRONMENT", value = "production" },
    { name = "STORAGE_BACKEND", value = "s3" },
    { name = "S3_BUCKET", value = aws_s3_bucket.main.id },
    { name = "S3_REGION", value = var.region },
    # No S3_ENDPOINT_URL / keys: boto3 uses the ECS task role.
    { name = "REDIS_URL", value = "rediss://${aws_elasticache_replication_group.main.primary_endpoint_address}:6379/0" },
    { name = "FRONTEND_URL", value = local.public_url },
    { name = "PUBLIC_API_URL", value = "${local.public_url}/api" },
    { name = "CORS_ORIGINS", value = local.public_url },
    { name = "COOKIE_SECURE", value = local.https ? "true" : "false" },
    { name = "REFRESH_COOKIE_PATH", value = "/api/auth" },
    { name = "EMAIL_BACKEND", value = "ses" },
    { name = "BOT_LAUNCHER", value = "ecs" },
    # Consumed by the ECS bot launcher (names must match backend/app/worker/bot_launchers once implemented).
    { name = "ECS_CLUSTER", value = aws_ecs_cluster.main.name },
    { name = "ECS_TASK_DEFINITION", value = aws_ecs_task_definition.bot.family },
    { name = "ECS_SUBNETS", value = join(",", aws_subnet.private[*].id) },
    { name = "ECS_SECURITY_GROUPS", value = aws_security_group.ecs.id },
    # Switch to local + TRANSCRIBER_URL when the GPU transcriber module (transcriber.tf) is enabled.
    { name = "TRANSCRIBER_MODE", value = "api" },
  ]

  backend_secrets = concat(
    [{ name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn }],
    [for k in local.app_secret_keys : { name = k, valueFrom = aws_secretsmanager_secret.app[k].arn }],
  )
}

# ---------------------------------------------------------------- network (2 AZ)
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.prefix }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.prefix}-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  tags              = { Name = "${local.prefix}-private-${count.index}" }
}

# One NAT gateway to keep cost down; use one per AZ for AZ-failure tolerance.
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Keep S3 traffic off the NAT gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]
}

# ---------------------------------------------------------------- security groups
resource "aws_security_group" "alb" {
  name_prefix = "${local.prefix}-alb-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "ecs" {
  name_prefix = "${local.prefix}-ecs-"
  vpc_id      = aws_vpc.main.id
  # ALB -> frontend
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  # frontend -> backend (bots launched with this SG also reach the backend this way)
  ingress {
    from_port = 8000
    to_port   = 8000
    protocol  = "tcp"
    self      = true
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "rds" {
  name_prefix = "${local.prefix}-rds-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_security_group" "redis" {
  name_prefix = "${local.prefix}-redis-"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs.id]
  }
  lifecycle { create_before_destroy = true }
}

# ---------------------------------------------------------------- ECR
resource "aws_ecr_repository" "repo" {
  for_each             = toset(["frontend", "backend", "notetaker-bot", "transcriber"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "repo" {
  for_each   = aws_ecr_repository.repo
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------------------------------------------------------- S3
resource "aws_s3_bucket" "main" {
  bucket = var.bucket_name
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256" # SSE-S3
    }
  }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    id     = "expire-exports"
    status = "Enabled"
    filter {
      prefix = "exports/"
    }
    expiration {
      days = var.exports_expiration_days
    }
  }
  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# ---------------------------------------------------------------- RDS PostgreSQL 16
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = local.prefix
  subnet_ids = aws_subnet.private[*].id
}

# pgvector is an allowed extension on RDS PostgreSQL 16 and needs no shared_preload_libraries entry; the first
# Alembic migration runs `CREATE EXTENSION vector` (the master user may do so). Add tuning parameters here.
resource "aws_db_parameter_group" "main" {
  name_prefix = "${local.prefix}-pg16-"
  family      = "postgres16"
  lifecycle { create_before_destroy = true }
}

resource "aws_db_instance" "main" {
  identifier                   = local.prefix
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = var.db_instance_class
  allocated_storage            = var.db_allocated_storage
  max_allocated_storage        = var.db_allocated_storage * 4
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_name                      = "intervue_db"
  username                     = "intervue"
  password                     = random_password.db.result
  db_subnet_group_name         = aws_db_subnet_group.main.name
  vpc_security_group_ids       = [aws_security_group.rds.id]
  parameter_group_name         = aws_db_parameter_group.main.name
  multi_az                     = var.db_multi_az
  backup_retention_period      = 14
  deletion_protection          = var.db_deletion_protection
  skip_final_snapshot          = !var.db_deletion_protection
  final_snapshot_identifier    = var.db_deletion_protection ? "${local.prefix}-final" : null
  performance_insights_enabled = true
  auto_minor_version_upgrade   = true
}

# ---------------------------------------------------------------- ElastiCache (Redis; use engine "valkey" if preferred)
resource "aws_elasticache_subnet_group" "main" {
  name       = local.prefix
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.prefix
  description                = "Celery broker / cache"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  transit_encryption_enabled = true # hence rediss:// in REDIS_URL
  at_rest_encryption_enabled = true
}

# ---------------------------------------------------------------- Secrets Manager
resource "aws_secretsmanager_secret" "app" {
  for_each                = toset(local.app_secret_keys)
  name                    = "${local.prefix}/${each.key}"
  recovery_window_in_days = 7
}

# Placeholder so ECS can resolve the secret before you set the real value.
resource "aws_secretsmanager_secret_version" "app" {
  for_each      = aws_secretsmanager_secret.app
  secret_id     = each.value.id
  secret_string = "CHANGE_ME"
  lifecycle { ignore_changes = [secret_string] }
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${local.prefix}/DATABASE_URL"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql+psycopg2://${aws_db_instance.main.username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${aws_db_instance.main.db_name}"
}

# ---------------------------------------------------------------- SES (placeholder)
resource "aws_ses_domain_identity" "main" {
  count  = var.ses_domain != "" ? 1 : 0
  domain = var.ses_domain
}

resource "aws_ses_domain_dkim" "main" {
  count  = var.ses_domain != "" ? 1 : 0
  domain = aws_ses_domain_identity.main[0].domain
}
# TODO: create the verification TXT + 3 DKIM CNAME records in DNS, then request SES production access.

# ---------------------------------------------------------------- CloudWatch logs
resource "aws_cloudwatch_log_group" "svc" {
  for_each          = toset(["frontend", "backend", "worker", "beat", "bot", "transcriber"])
  name              = "/ecs/${local.prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}

# ---------------------------------------------------------------- IAM
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: pull images, write logs, read the secrets injected into containers.
resource "aws_iam_role" "execution" {
  name               = "${local.prefix}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = concat([aws_secretsmanager_secret.database_url.arn], [for s in aws_secretsmanager_secret.app : s.arn])
    }]
  })
}

# Backend / worker / beat task role: S3 scoped to the bucket, launch bot tasks, send mail.
resource "aws_iam_role" "backend_task" {
  name               = "${local.prefix}-backend-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "backend_task" {
  name = "app"
  role = aws_iam_role.backend_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.main.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.main.arn
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:RunTask"]
        Resource = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:task-definition/${aws_ecs_task_definition.bot.family}:*"
        Condition = {
          ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["ecs:StopTask", "ecs:DescribeTasks"]
        Resource = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:task/${aws_ecs_cluster.main.name}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [aws_iam_role.execution.arn, aws_iam_role.bot_task.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
    ]
  })
}

# Bot task role: intentionally has NO policies. Bots receive presigned URLs from the backend and hold no AWS
# permissions (no S3, no secrets). Do not attach anything here.
resource "aws_iam_role" "bot_task" {
  name               = "${local.prefix}-bot-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

# ---------------------------------------------------------------- ECS cluster + service discovery
resource "aws_ecs_cluster" "main" {
  name = local.prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

resource "aws_service_discovery_private_dns_namespace" "main" {
  name = "${var.name}.local"
  vpc  = aws_vpc.main.id
}

resource "aws_service_discovery_service" "backend" {
  name = "backend"
  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
  }
  health_check_custom_config {
    failure_threshold = 1
  }
}

# ---------------------------------------------------------------- ALB (frontend only; /api is proxied by Next.js)
resource "aws_lb" "main" {
  name               = local.prefix
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "frontend" {
  name        = "${local.prefix}-fe"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path    = "/"
    matcher = "200-399"
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.https ? "redirect" : "forward"
    target_group_arn = local.https ? null : aws_lb_target_group.frontend.arn
    dynamic "redirect" {
      for_each = local.https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.https ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }
}

# ---------------------------------------------------------------- optional CloudFront
resource "aws_cloudfront_distribution" "main" {
  count   = var.enable_cloudfront ? 1 : 0
  enabled = true
  aliases = var.domain_name != "" ? [var.domain_name] : []

  origin {
    origin_id   = "alb"
    domain_name = aws_lb.main.dns_name
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = local.https ? "https-only" : "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id         = "alb"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
    origin_request_policy_id = "216adef6-5c7f-47e4-b989-5492eafa07d3" # Managed-AllViewer
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = var.acm_certificate_arn == ""
    acm_certificate_arn            = var.acm_certificate_arn != "" ? var.acm_certificate_arn : null
    ssl_support_method             = var.acm_certificate_arn != "" ? "sni-only" : null
    minimum_protocol_version       = var.acm_certificate_arn != "" ? "TLSv1.2_2021" : null
  }
}

# ---------------------------------------------------------------- task definitions
resource "aws_ecs_task_definition" "frontend" {
  family                   = "${local.prefix}-frontend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.frontend_cpu
  memory                   = var.frontend_memory
  execution_role_arn       = aws_iam_role.execution.arn
  container_definitions = jsonencode([{
    name = "frontend"
    # The backend address is baked in at image build time:
    #   docker build --build-arg BACKEND_INTERNAL_URL=http://backend.<var.name>.local:8000 ./frontend
    image        = "${aws_ecr_repository.repo["frontend"].repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 3000 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["frontend"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${local.prefix}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.backend_cpu
  memory                   = var.backend_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn
  container_definitions = jsonencode([{
    name         = "backend"
    image        = "${aws_ecr_repository.repo["backend"].repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = 8000 }]
    environment  = concat(local.backend_env, [{ name = "RUN_MIGRATIONS", value = "true" }])
    secrets      = local.backend_secrets
    healthCheck = {
      command     = ["CMD-SHELL", "curl -fsS http://localhost:8000/healthz || exit 1"]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["backend"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.prefix}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn
  container_definitions = jsonencode([{
    name        = "worker"
    image       = "${aws_ecr_repository.repo["backend"].repository_url}:${var.image_tag}"
    essential   = true
    command     = ["celery", "-A", "app.worker.celery_app.celery_app", "worker", "-l", "info", "-Q", "default", "--concurrency", "2"]
    environment = local.backend_env
    secrets     = local.backend_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["worker"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "beat" {
  family                   = "${local.prefix}-beat"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.backend_task.arn
  container_definitions = jsonencode([{
    name        = "beat"
    image       = "${aws_ecr_repository.repo["backend"].repository_url}:${var.image_tag}"
    essential   = true
    command     = ["celery", "-A", "app.worker.celery_app.celery_app", "beat", "-l", "info", "-s", "/tmp/celerybeat-schedule"]
    environment = local.backend_env
    secrets     = local.backend_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["beat"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# Notetaker bot: launched per meeting by the backend via ecs:RunTask (no service). The launcher overrides the
# environment (session id, meeting URL, callback URL/secret, upload prefix). Task role has no permissions.
resource "aws_ecs_task_definition" "bot" {
  family                   = "${local.prefix}-bot"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.bot_cpu
  memory                   = var.bot_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.bot_task.arn
  container_definitions = jsonencode([{
    name            = "bot"
    image           = "${aws_ecr_repository.repo["notetaker-bot"].repository_url}:${var.bot_image_tag}"
    essential       = true
    environment     = [{ name = "BOT_MODE", value = "single" }]
    linuxParameters = { sharedMemorySize = 1024 } # note: sharedMemorySize is EC2-only; on Fargate Chromium may need --disable-dev-shm-usage
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.svc["bot"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "ecs"
      }
    }
  }])
}

# ---------------------------------------------------------------- services
resource "aws_ecs_service" "frontend" {
  name            = "frontend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.frontend.arn
  desired_count   = var.frontend_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.frontend.arn
    container_name   = "frontend"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "backend" {
  name            = "backend"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.backend_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs.id]
  }
  service_registries {
    registry_arn = aws_service_discovery_service.backend.arn
  }
  lifecycle { ignore_changes = [desired_count] } # owned by autoscaling below
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs.id]
  }
}

# beat must be exactly one task, and old/new must never overlap during deploys.
resource "aws_ecs_service" "beat" {
  name                               = "beat"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.beat.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs.id]
  }
}

# ---------------------------------------------------------------- autoscaling (backend on CPU)
resource "aws_appautoscaling_target" "backend" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.backend_desired_count
  max_capacity       = var.backend_desired_count * 4
}

resource "aws_appautoscaling_policy" "backend_cpu" {
  name               = "${local.prefix}-backend-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.backend.service_namespace
  resource_id        = aws_appautoscaling_target.backend.resource_id
  scalable_dimension = aws_appautoscaling_target.backend.scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
# TODO: scale `worker` on Celery queue depth: publish a CloudWatch metric (Redis LLEN) and add a
# target-tracking policy on it.

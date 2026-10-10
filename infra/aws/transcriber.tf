# OPTIONAL: GPU transcriber on ECS with an EC2 capacity provider (g4dn). Everything below is commented out
# because it needs a GPU-capable ECS-optimized AMI, a g4dn instance quota, and a decision on how the backend
# reaches it (Cloud Map name like transcriber.<name>.local:8100). Uncomment and fill in to use it, then set
# TRANSCRIBER_MODE=local and TRANSCRIBER_URL=http://transcriber.<name>.local:8100 on backend/worker.
#
# data "aws_ssm_parameter" "ecs_gpu_ami" {
#   name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/gpu/recommended/image_id"
# }
#
# resource "aws_iam_role" "ecs_instance" {
#   name = "${local.prefix}-ecs-instance"
#   assume_role_policy = jsonencode({
#     Version = "2012-10-17"
#     Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
#   })
# }
# resource "aws_iam_role_policy_attachment" "ecs_instance" {
#   role       = aws_iam_role.ecs_instance.name
#   policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
# }
# resource "aws_iam_instance_profile" "ecs_instance" {
#   name = "${local.prefix}-ecs-instance"
#   role = aws_iam_role.ecs_instance.name
# }
#
# resource "aws_launch_template" "gpu" {
#   name_prefix            = "${local.prefix}-gpu-"
#   image_id               = data.aws_ssm_parameter.ecs_gpu_ami.value
#   instance_type          = "g4dn.xlarge"
#   vpc_security_group_ids = [aws_security_group.ecs.id]
#   iam_instance_profile {
#     arn = aws_iam_instance_profile.ecs_instance.arn
#   }
#   user_data = base64encode("#!/bin/bash\necho ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config\n")
# }
#
# resource "aws_autoscaling_group" "gpu" {
#   name                  = "${local.prefix}-gpu"
#   min_size              = 0
#   max_size              = 2
#   vpc_zone_identifier   = aws_subnet.private[*].id
#   protect_from_scale_in = true
#   launch_template {
#     id      = aws_launch_template.gpu.id
#     version = "$Latest"
#   }
#   tag {
#     key                 = "AmazonECSManaged"
#     value               = "true"
#     propagate_at_launch = true
#   }
# }
#
# resource "aws_ecs_capacity_provider" "gpu" {
#   name = "${local.prefix}-gpu"
#   auto_scaling_group_provider {
#     auto_scaling_group_arn         = aws_autoscaling_group.gpu.arn
#     managed_termination_protection = "ENABLED"
#     managed_scaling {
#       status          = "ENABLED"
#       target_capacity = 100
#     }
#   }
# }
# # Also add aws_ecs_capacity_provider.gpu.name to aws_ecs_cluster_capacity_providers.main in main.tf.
#
# resource "aws_ecs_task_definition" "transcriber" {
#   family                   = "${local.prefix}-transcriber"
#   requires_compatibilities = ["EC2"]
#   network_mode             = "awsvpc"
#   execution_role_arn       = aws_iam_role.execution.arn
#   container_definitions = jsonencode([{
#     name      = "transcriber"
#     image     = "${aws_ecr_repository.repo["transcriber"].repository_url}:${var.image_tag}" # services/transcriber/Dockerfile (GPU)
#     essential = true
#     memory    = 14000
#     resourceRequirements = [{ type = "GPU", value = "1" }]
#     portMappings         = [{ containerPort = 8100 }]
#     environment          = [{ name = "PORT", value = "8100" }, { name = "WHISPER_DEVICE", value = "cuda" }]
#     secrets = [
#       { name = "TRANSCRIBER_API_KEY", valueFrom = aws_secretsmanager_secret.app["TRANSCRIBER_API_KEY"].arn },
#       { name = "TRANSCRIBER_CALLBACK_SECRET", valueFrom = aws_secretsmanager_secret.app["TRANSCRIBER_CALLBACK_SECRET"].arn },
#     ]
#     logConfiguration = {
#       logDriver = "awslogs"
#       options = {
#         awslogs-group         = aws_cloudwatch_log_group.svc["transcriber"].name
#         awslogs-region        = var.region
#         awslogs-stream-prefix = "ecs"
#       }
#     }
#   }])
# }
#
# resource "aws_ecs_service" "transcriber" {
#   name            = "transcriber"
#   cluster         = aws_ecs_cluster.main.id
#   task_definition = aws_ecs_task_definition.transcriber.arn
#   desired_count   = 1
#   capacity_provider_strategy {
#     capacity_provider = aws_ecs_capacity_provider.gpu.name
#     weight            = 1
#   }
#   network_configuration {
#     subnets         = aws_subnet.private[*].id
#     security_groups = [aws_security_group.ecs.id]
#   }
#   # + service_registries for Cloud Map (transcriber.<name>.local) and an 8100 self-ingress rule on the ecs SG.
# }

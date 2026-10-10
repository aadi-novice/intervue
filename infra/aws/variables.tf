variable "region" {
  type    = string
  default = "us-east-1"
}

variable "environment" {
  type    = string
  default = "prod"
}

variable "name" {
  description = "Resource name prefix."
  type        = string
  default     = "intervue"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "domain_name" {
  description = "Public hostname (e.g. app.example.com). Used for FRONTEND_URL / CORS. Leave empty to use the ALB DNS name over HTTP (testing only)."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate (in var.region, or us-east-1 for CloudFront) for HTTPS. Required for production."
  type        = string
  default     = ""
}

variable "enable_cloudfront" {
  description = "Put CloudFront in front of the ALB (needs acm_certificate_arn in us-east-1 for a custom domain)."
  type        = bool
  default     = false
}

variable "image_tag" {
  description = "Tag of the images pushed to the ECR repositories."
  type        = string
  default     = "latest"
}

# ---- sizing ----
variable "frontend_cpu" {
  type    = number
  default = 512
}
variable "frontend_memory" {
  type    = number
  default = 1024
}
variable "backend_cpu" {
  type    = number
  default = 1024
}
variable "backend_memory" {
  type    = number
  default = 2048
}
variable "worker_cpu" {
  type    = number
  default = 1024
}
variable "worker_memory" {
  type    = number
  default = 2048
}
variable "frontend_desired_count" {
  type    = number
  default = 2
}
variable "backend_desired_count" {
  type    = number
  default = 2
}
variable "worker_desired_count" {
  type    = number
  default = 1
}

# ---- data stores ----
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}
variable "db_allocated_storage" {
  type    = number
  default = 50
}
variable "db_multi_az" {
  description = "Multi-AZ RDS (recommended in prod)."
  type        = bool
  default     = true
}
variable "db_deletion_protection" {
  type    = bool
  default = true
}
variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

# ---- storage ----
variable "bucket_name" {
  description = "Globally unique S3 bucket name for resumes/transcripts/avatars/recordings/exports."
  type        = string
}
variable "exports_expiration_days" {
  type    = number
  default = 7
}

# ---- bots ----
variable "bot_image_tag" {
  type    = string
  default = "latest"
}
variable "bot_cpu" {
  type    = number
  default = 2048
}
variable "bot_memory" {
  type    = number
  default = 4096
}

# ---- email ----
variable "ses_domain" {
  description = "Domain to verify in SES (placeholder; DNS records must be added manually). Empty skips SES."
  type        = string
  default     = ""
}

variable "log_retention_days" {
  type    = number
  default = 30
}

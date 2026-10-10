terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configure a remote backend before real use, e.g.:
  # backend "s3" {
  #   bucket         = "your-tfstate-bucket"
  #   key            = "intervue/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "your-tf-locks"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "intervue"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

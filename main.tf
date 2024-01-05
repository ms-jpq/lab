terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
  }
}

variable "aws_region" { type = string }

provider "aws" {
  region = var.aws_region
}

resource "aws_instance" "droplet" {
  instance_type = "t4g.small"
}

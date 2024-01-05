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

resource "aws_launch_template" "smol-22" {
  image_id      = "ami-0a24e6e101933d294"
  instance_type = "t4g.small"
  name          = "smol-22"
  user_data     = filebase64("${path.module}/cloud-init/user-data.yml")

  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size = 50
    }
  }
}

# resource "aws_instance" "droplet" {
#   launch_template {
#     id = aws_launch_template.smol.id
#   }
# }

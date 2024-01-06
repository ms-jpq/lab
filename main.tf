terraform {
  required_providers {
    http = {
      source = "hashicorp/http"
    }
    aws = {
      source = "hashicorp/aws"
    }

  }
}

variable "aws_region" { type = string }
variable "github_user" { type = string }

data "http" "gh_keys" {
  url = "https://github.com/${var.github_user}.keys"
}

locals {
  ssh_keys  = split("\n", trimspace(data.http.gh_keys.response_body))
  user_data = base64encode(templatefile("${path.module}/cloud-init/user-data.yml", { ssh_keys = jsonencode(local.ssh_keys) }))
}

provider "aws" {
  region = var.aws_region
}

resource "aws_security_group" "nypd" {
  name = "nypd"
}

resource "aws_vpc_security_group_ingress_rule" "acab_4" {
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
  security_group_id = aws_security_group.nypd.id
}

resource "aws_vpc_security_group_ingress_rule" "acab_6" {
  cidr_ipv6         = "::/0"
  ip_protocol       = "-1"
  security_group_id = aws_security_group.nypd.id
}

resource "aws_launch_template" "smol-jammy" {
  image_id      = "ami-0a24e6e101933d294" # Ubuntu 22.04 arm64
  instance_type = "t4g.small"
  name          = "smol-jammy"
  user_data     = local.user_data

  vpc_security_group_ids = [aws_security_group.nypd.id]
  block_device_mappings {
    device_name = "/dev/sda1"
    ebs {
      volume_size = 50
      volume_type = "gp3"
    }
  }
}

resource "aws_instance" "droplet" {
  launch_template {
    id = aws_launch_template.smol-jammy.id
  }
}

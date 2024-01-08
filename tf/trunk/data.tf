variable "github_user" {
  type = string
}

variable "le_domain" {
  type = string
}

data "aws_ami" "ubuntu-lts" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "architecture"
    values = ["arm64"]
  }

  filter {
    name   = "name"
    values = ["*ubuntu-jammy-22.04-arm64-server*"]
  }
}

data "http" "gh_keys" {
  url = "https://github.com/${var.github_user}.keys"
}

locals {
  dns_ttl  = 60
  ssh_keys = sort(split("\n", trimspace(data.http.gh_keys.response_body)))
}

data "cloudinit_config" "ci_data" {
  part {
    content      = trimspace(templatefile("${path.module}/user-data.yml", { AUTHORIZED_KEYS = jsonencode(local.ssh_keys) }))
    content_type = "text/cloud-config"
  }
}

resource "terraform_data" "user_data" {
  # https://github.com/hashicorp/terraform-provider-aws/issues/5011
  input = data.cloudinit_config.ci_data.rendered
}

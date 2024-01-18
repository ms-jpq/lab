variable "github_user" {
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

output "ami-ubuntu-lts" {
  value = {
    id   = data.aws_ami.ubuntu-lts.id
    name = data.aws_ami.ubuntu-lts.name
  }
}

data "http" "gh_keys" {
  url = "https://github.com/${var.github_user}.keys"
}

locals {
  dns_ttl  = 60
  ssh_keys = sort(split("\n", trimspace(data.http.gh_keys.response_body)))
  user_data = {
    growpart = {
      devices                  = [{ name = "/" }]
      ignore_growroot_disabled = false
      mode                     = "auto"
    }
    users = [
      {
        name                = "root"
        ssh-authorized-keys = local.ssh_keys
      }
    ]
  }
}

data "cloudinit_config" "ci_data" {
  part {
    content      = yamlencode(local.user_data)
    content_type = "text/cloud-config"
  }
}

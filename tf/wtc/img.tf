variable "github_users" {
  type = list(string)
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
  for_each = toset(var.github_users)
  url      = "https://github.com/${each.key}.keys"
}

locals {
  ssh_keys = sort(flatten([
    for resp in data.http.gh_keys :
    split("\n", trimspace(resp.response_body))
  ]))
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

resource "aws_launch_template" "familia" {
  image_id  = data.aws_ami.ubuntu-lts.id
  name      = "familia"
  user_data = data.cloudinit_config.ci_data.rendered

  network_interfaces {
    security_groups = [aws_security_group.acab.id]
    subnet_id       = aws_subnet.onlyfams.id
  }
}

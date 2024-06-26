data "aws_ami" "ubuntu_lts" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "state"
    values = ["available"]
  }

  filter {
    name   = "architecture"
    values = ["x86_64"]
  }

  filter {
    name   = "name"
    values = ["*ubuntu-noble-24.04-amd64-server*"]
  }
}

output "ami_ubuntu_lts" {
  value = {
    id   = data.aws_ami.ubuntu_lts.id
    name = data.aws_ami.ubuntu_lts.name
  }
}

locals {
  cloud_init_scripts = "${path.module}/cloud-init"
  user_data = {
    # TODO: index of ebs blk storage is unpredictable
    fs_setup = [
      for n in range(0, 3) :
      {
        device     = "/dev/nvme${n}n1"
        filesystem = "xfs"
        label      = "docker"
      }
    ]
    growpart = {
      ignore_growroot_disabled = true
    }
    mounts = [
      ["LABEL=docker", "/var/lib/docker"]
    ]
    package_update = true
    packages       = ["zfsutils-linux"]
    # TODO: swap needs to run after mkfs
    # swap = {
    #   filename = "/var/lib/docker/swapfile"
    #   size     = "6G"
    # }
    users = [
      {
        name                = "root"
        ssh_authorized_keys = local.ssh_keys
      }
    ]
  }
}

data "cloudinit_config" "ci_data" {
  part {
    content      = yamlencode(local.user_data)
    content_type = "text/cloud-config"
  }
  dynamic "part" {
    for_each = fileset(local.cloud_init_scripts, "*.sh")
    content {
      content      = file("${local.cloud_init_scripts}/${part.value}")
      content_type = "text/x-shellscript"
    }
  }
}

resource "aws_launch_template" "familia" {
  image_id  = data.aws_ami.ubuntu_lts.id
  name      = "familia"
  user_data = data.cloudinit_config.ci_data.rendered

  block_device_mappings {
    device_name = "/dev/sdf"
    ebs {
      delete_on_termination = true
      volume_size           = 39
      volume_type           = "gp3"
    }
  }
  network_interfaces {
    security_groups = [aws_security_group.acab.id]
    subnet_id       = aws_subnet.onlyfams.id
  }
}

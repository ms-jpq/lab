data "google_compute_image" "ubuntu_lts" {
  family      = "ubuntu-2404-lts-arm64"
  most_recent = true
  project     = "ubuntu-os-cloud"
}

output "ami_ubuntu_lts" {
  value = {
    id   = data.google_compute_image.ubuntu_lts.id
    name = data.google_compute_image.ubuntu_lts.name
  }
}

locals {
  user_data = {
    # TODO: index of ebs blk storage is unpredictable
    # fs_setup = [
    #   for n in range(0, 3) :
    #   {
    #     device     = "/dev/nvme${n}n1"
    #     filesystem = "xfs"
    #     label      = "docker"
    #   }
    # ]
    growpart = {
      ignore_growroot_disabled = true
    }
    # mounts = [
    #   ["LABEL=docker", "/var/lib/docker"]
    # ]
    package_update = true
    packages       = ["zfsutils-linux"]
    # TODO: swap needs to run after mkfs
    # swap = {
    #   filename = "/var/lib/docker/swapfile"
    #   size     = "5G"
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
}

resource "google_compute_instance_template" "familia" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  machine_type = "e2-small"
  disk {
    source_image = data.google_compute_image.ubuntu_lts.self_link
  }
  network_interface {
    stack_type = google_compute_subnetwork.onlyfams.stack_type
    subnetwork = google_compute_subnetwork.onlyfams.id
    access_config {
      network_tier = "PREMIUM"
    }
    ipv6_access_config {
      network_tier = "PREMIUM"
    }
  }
  metadata = {
    serial-port-enable = "TRUE"
    user-data          = data.cloudinit_config.ci_data.rendered
  }
}

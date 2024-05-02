data "google_compute_image" "ubuntu_lts" {
  family      = "ubuntu-2404-lts-amd64"
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
  cloud_init_scripts = "${path.module}/cloud-init"
  user_scripts = [
    for script in fileset(local.cloud_init_scripts, "*.sh") :
    {
      content = file("${local.cloud_init_scripts}/${script}")
      path    = "/tmp/${script}"
    }
  ]
  user_data = {
    fs_setup = [
      {
        device     = "/dev/sdb"
        filesystem = "xfs"
        label      = "docker"
      },
      {
        device     = "/dev/sdc"
        filesystem = "btrfs"
        label      = local.gcp_disk
      }
    ]
    growpart = {
      ignore_growroot_disabled = true
    }
    mounts = [
      ["LABEL=docker", "/var/lib/docker"],
      ["LABEL=${local.gcp_disk}", "/var/lib/local"]
    ]
    package_update = true
    packages       = ["zfsutils-linux"]
    # TODO: swap needs to run after mkfs
    # swap = {
    #   filename = "/var/lib/docker/swapfile"
    #   size     = "6G"
    # }
    runcmd = concat([
      for script in local.user_scripts :
      [["chmod", "+x", "--", script.path], [script.path]]
    ]...)
    users = [
      {
        name                = "root"
        ssh_authorized_keys = local.ssh_keys
      }
    ]
    write_files = local.user_scripts
  }
}

locals {
  compute_disk_type = "pd-standard"
}

resource "google_compute_instance_template" "familia" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  machine_type = "e2-small"
  disk {
    disk_type    = local.compute_disk_type
    source_image = data.google_compute_image.ubuntu_lts.self_link
  }
  disk {
    disk_type    = local.compute_disk_type
    disk_size_gb = 60
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
    user-data          = "#cloud-config\n---\n${yamlencode(local.user_data)}"
  }
}

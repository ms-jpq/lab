data "google_compute_image" "ubuntu_lts" {
  family      = "ubuntu-24"
  most_recent = true
}

output "ami_ubuntu_lts" {
  value = {
    id   = data.google_compute_image.ubuntu_lts.id
    name = data.google_compute_image.ubuntu_lts.name
  }
}

resource "google_compute_instance_template" "familia" {
  provider     = google.ca_e2
  project      = local.gcp_project
  machine_type = "e2-small"
  disk {
    source_image = data.google_compute_image.ubuntu_lts.self_link
  }
  network_interface {
    network = "default"
  }
}

data "google_compute_disk" "john" {
  provider = google.ca_e2
  project  = local.gcp_project
  name     = "iscsi-fuchsia"
}

resource "google_compute_instance" "droplet" {
  provider                  = google.ca_e2
  project                   = local.gcp_project
  allow_stopping_for_update = true
  machine_type              = "e2-micro"
  name                      = "droplet"
  zone                      = data.google_compute_disk.john.zone
  boot_disk {
    initialize_params {
      image = data.google_compute_image.ubuntu_lts.self_link
      type  = "pd-standard"
    }
  }
  network_interface {
    network = "default"
  }
}

resource "google_compute_attached_disk" "cena" {
  provider = google.ca_e2
  project  = local.gcp_project
  disk     = data.google_compute_disk.john.id
  instance = google_compute_instance.droplet.id
}

locals {
  ip_addrs = {
    v4 = [google_compute_instance.droplet.network_interface[0].network_ip]
    v6 = []
  }
}

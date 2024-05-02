data "google_compute_disk" "john" {
  provider = google.ca_e2
  project  = local.gcp_project
  name     = "iscsi-fuchsia"
  zone     = local.gcp_regions.ca_e2[0]
}

resource "google_compute_instance_from_template" "droplet" {
  provider                 = google.ca_e2
  project                  = data.google_compute_disk.john.project
  name                     = "droplet"
  source_instance_template = google_compute_instance_template.familia.self_link
  zone                     = data.google_compute_disk.john.zone
  network_interface {
    access_config {
      nat_ip = google_compute_address.vinfast.address
    }
  }
}

resource "google_compute_attached_disk" "cena" {
  provider = google.ca_e2
  project  = data.google_compute_disk.john.project
  disk     = data.google_compute_disk.john.id
  instance = google_compute_instance_from_template.droplet.id
}

locals {
  ip_addrs = {
    v4 = flatten([
      for nic in google_compute_instance_from_template.droplet.network_interface :
      [for conf in nic.access_config : conf.nat_ip]
    ])
    v6 = flatten([
      for nic in google_compute_instance_from_template.droplet.network_interface :
      [for conf in nic.ipv6_access_config : conf.external_ipv6]
    ])
  }
}

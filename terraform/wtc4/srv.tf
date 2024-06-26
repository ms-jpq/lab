locals {
  gcp_disk = "fuchsia"
}

data "google_compute_disk" "john" {
  provider = google.kalimdor
  name     = "iscsi-${local.gcp_disk}"
  zone     = local.gcp_regions.kalimdor[0]
}

resource "google_compute_instance_from_template" "droplet" {
  provider                 = google.kalimdor
  name                     = "droplet"
  source_instance_template = google_compute_instance_template.familia.self_link
  zone                     = data.google_compute_disk.john.zone
}

resource "google_compute_attached_disk" "cena" {
  provider = google.kalimdor
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

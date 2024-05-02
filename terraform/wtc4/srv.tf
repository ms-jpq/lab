data "google_compute_disk" "john" {
  provider = google.ca_e2
  project  = local.gcp_project
  name     = "iscsi-fuchsia"
  zone     = local.gcp_regions.ca_e2[0]
}

resource "google_compute_instance_from_template" "droplet" {
  provider                 = google.ca_e2
  project                  = local.gcp_project
  name                     = "droplet"
  source_instance_template = google_compute_instance_template.familia.self_link
  zone                     = data.google_compute_disk.john.zone
}

resource "google_compute_attached_disk" "cena" {
  provider = google.ca_e2
  project  = local.gcp_project
  disk     = data.google_compute_disk.john.id
  instance = google_compute_instance_from_template.droplet.id
}

# locals {
#   ip_addrs = {
#     v4 = [google_compute_instance.droplet.network_interface[0].network_ip]
#     v6 = []
#   }
# }

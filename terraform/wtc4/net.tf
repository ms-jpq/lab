resource "google_compute_address" "vinfast" {
  provider = google.ca_e2
  project  = data.google_compute_disk.john.project
  name     = "vinfast"
}

resource "google_compute_network" "fastx" {
  provider                = google.ca_e2
  project                 = data.google_compute_disk.john.project
  auto_create_subnetworks = false
  name                    = "fastx"
}

resource "google_compute_subnetwork" "onlyfams" {
  provider         = google.ca_e2
  project          = data.google_compute_disk.john.project
  ip_cidr_range    = "10.0.0.0/8"
  ipv6_access_type = "EXTERNAL"
  name             = "onlyfams"
  network          = google_compute_network.fastx.id
  stack_type       = "IPV4_IPV6"
}

# resource "google_compute_firewall" "acab" {
#   provider      = google.ca_e2
#   project       = data.google_compute_disk.john.project
#   name          = "acab"
#   network       = google_compute_network.fastx.id
#   source_ranges = ["0.0.0.0/0", "::/0"]
#   allow {
#     protocol = "all"
#   }
# }

resource "google_compute_network" "fastx" {
  provider                = google.kalimdor
  auto_create_subnetworks = false
  name                    = "fastx"
}

resource "google_compute_subnetwork" "onlyfams" {
  provider         = google.kalimdor
  ip_cidr_range    = local.vpc_cidr
  ipv6_access_type = "EXTERNAL"
  name             = "onlyfams"
  network          = google_compute_network.fastx.id
  stack_type       = "IPV4_IPV6"
}

resource "google_compute_firewall" "acab" {
  provider      = google.kalimdor
  for_each      = { v4 = "0.0.0.0/0", v6 = "::/0" }
  name          = "acab-${each.key}"
  network       = google_compute_network.fastx.id
  source_ranges = [each.value]
  allow {
    protocol = "all"
  }
}

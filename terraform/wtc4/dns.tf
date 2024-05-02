data "google_dns_managed_zone" "sea_to_sky" {
  provider = google.ca_e2
  project  = data.google_compute_disk.john.project
  name     = replace(var.le_domain, ".", "-")
}

resource "google_dns_record_set" "sea_to_sky_mx" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = ["1 ${data.google_dns_managed_zone.sea_to_sky.dns_name}"]
  type         = "MX"
}

resource "google_dns_record_set" "sea_to_sky_c" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = "*.${data.google_dns_managed_zone.sea_to_sky.dns_name}"
  rrdatas      = [data.google_dns_managed_zone.sea_to_sky.dns_name]
  type         = "CNAME"
}

resource "google_dns_record_set" "sea_to_sky_a" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = local.ip_addrs.v4
  type         = "A"
}

resource "google_dns_record_set" "sea_to_sky_a4" {
  provider     = google.ca_e2
  project      = data.google_compute_disk.john.project
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = local.ip_addrs.v6
  type         = "AAAA"
}

output "dns" {
  value = {
    a  = google_dns_record_set.sea_to_sky_a.rrdatas
    a4 = google_dns_record_set.sea_to_sky_a4.rrdatas
    mx = google_dns_record_set.sea_to_sky_mx.rrdatas
  }
}

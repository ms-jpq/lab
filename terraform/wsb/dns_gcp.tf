resource "google_dns_managed_zone" "sea_to_sky" {
  provider = google.kalimdor
  for_each = toset([var.le_domain])
  name     = replace(each.key, ".", "-")
  dns_name = "${each.key}."
}

output "google_dns_name_servers" {
  value = {
    for srv in google_dns_managed_zone.sea_to_sky :
    srv.dns_name => srv.name_servers
  }
}

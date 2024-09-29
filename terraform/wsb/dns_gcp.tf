resource "google_dns_managed_zone" "sea_to_sky" {
  provider = google.kalimdor
  for_each = toset(concat(var.managed_domains, [var.vps_domain]))
  name     = replace(each.key, ".", "-")
  dns_name = "${each.key}."
}

output "cloud_dns_name_servers" {
  value = {
    for srv in google_dns_managed_zone.sea_to_sky :
    srv.dns_name => srv.name_servers
  }
}

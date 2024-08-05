data "google_dns_managed_zone" "sea_to_sky" {
  provider = google.kalimdor
  name     = replace(var.le_domain, ".", "-")
}

resource "google_dns_record_set" "sea_to_sky_mx" {
  provider     = google.kalimdor
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = ["1 ${data.google_dns_managed_zone.sea_to_sky.dns_name}"]
  ttl          = local.dns_ttl
  type         = "MX"
}

resource "google_dns_record_set" "sea_to_sky_c" {
  provider     = google.kalimdor
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = "*.${data.google_dns_managed_zone.sea_to_sky.dns_name}"
  rrdatas      = [data.google_dns_managed_zone.sea_to_sky.dns_name]
  ttl          = local.dns_ttl
  type         = "CNAME"
}

resource "google_dns_record_set" "sea_to_sky_a" {
  provider     = google.kalimdor
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = local.ip_addrs.v4
  ttl          = local.dns_ttl
  type         = "A"
}

resource "google_dns_record_set" "sea_to_sky_a4" {
  provider     = google.kalimdor
  managed_zone = data.google_dns_managed_zone.sea_to_sky.name
  name         = data.google_dns_managed_zone.sea_to_sky.dns_name
  rrdatas      = local.ip_addrs.v6
  ttl          = local.dns_ttl
  type         = "AAAA"
}

# resource "google_dns_managed_zone" "squamish" {
#   provider = google.kalimdor
#   for_each = local.dns_ptrs
#   name     = replace(each.key, ".", "-")
#   dns_name = "${each.key}."
# }
#
# resource "google_dns_record_set" "sea_to_sky_ptr" {
#   provider = google.kalimdor
#   for_each = merge([
#     for zone, addrs in local.dns_ptrs :
#     { for addr in addrs : addr => zone }
#   ]...)
#   managed_zone = google_dns_managed_zone.squamish[each.value].name
#   name         = "${each.key}."
#   rrdatas      = [data.google_dns_managed_zone.sea_to_sky.dns_name]
#   ttl          = local.dns_ttl
#   type         = "PTR"
# }

output "dns_gcp" {
  value = {
    a  = google_dns_record_set.sea_to_sky_a.rrdatas
    a4 = google_dns_record_set.sea_to_sky_a4.rrdatas
    mx = google_dns_record_set.sea_to_sky_mx.rrdatas
  }
}

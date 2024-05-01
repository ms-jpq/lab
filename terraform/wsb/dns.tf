resource "aws_route53_zone" "sea_to_sky" {
  for_each = toset([])
  name     = each.key
}

output "route53_name_servers" {
  value = {
    for srv in aws_route53_zone.sea_to_sky :
    srv.name => srv.name_servers
  }
}

resource "aws_lightsail_domain" "sea_to_sky" {
  provider    = aws.us_e1
  for_each    = toset([var.le_domain])
  domain_name = each.key
}

resource "google_dns_managed_zone" "sea_to_sky" {
  provider = google.ca_e2
  project  = local.gcp_project
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

data "external" "lightsail_nameserver" {
  program = ["${path.module}/lightsail_nameservers.sh"]
  query = {
    domains = jsonencode([
      for srv in aws_lightsail_domain.sea_to_sky
      : srv.domain_name
    ])
    region = local.aws_regions.us_e1
  }
}

output "lightsail_name_servers" {
  value = {
    for key, val in data.external.lightsail_nameserver.result :
    key => sort(jsondecode(val))
  }
}

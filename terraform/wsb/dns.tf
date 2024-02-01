resource "aws_route53_zone" "sea_to_sky" {
  for_each = toset([var.le_domain])
  name     = each.key
}

output "sea_to_sky_name_servers" {
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

data "external" "lightsail_nameserver" {
  program = ["${path.module}/lightsail_nameservers.sh"]
  query = {
    domains = jsonencode([
      for srv in aws_lightsail_domain.sea_to_sky
      : srv.domain_name
    ])
    region = local.us_e1_region
  }
}

output "sea_to_sky2" {
  value = {
    for key, val in data.external.lightsail_nameserver.result :
    key => sort(jsondecode(val))
  }
}

locals {
  sea_to_sky_domain = var.le_domain
}

resource "aws_lightsail_domain_entry" "sea_to_sky_mx" {
  domain_name = local.sea_to_sky_domain
  name        = local.sea_to_sky_domain
  target      = "1 ${data.aws_route53_zone.sea_to_sky.name}"
  type        = "MX"
}


resource "aws_lightsail_domain_entry" "sea_to_sky_c" {
  domain_name = local.sea_to_sky_domain
  name        = "*.${data.aws_route53_zone.sea_to_sky.name}"
  target      = local.sea_to_sky_domain
  type        = "CNAME"
}

resource "aws_lightsail_domain_entry" "sea_to_sky_a" {
  domain_name = local.sea_to_sky_domain
  name        = local.sea_to_sky_domain
  target      = aws_instance.droplet.public_ip
  type        = "A"
}

resource "aws_lightsail_domain_entry" "sea_to_sky_a4" {
  domain_name = local.sea_to_sky_domain
  for_each    = aws_instance.droplet.ipv6_addresses
  name        = local.sea_to_sky_domain
  target      = each.key
  type        = "AAAA"
}

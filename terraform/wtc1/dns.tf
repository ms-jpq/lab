locals {
  dns_ttl = 60
}

data "aws_route53_zone" "sea_to_sky" {
  name = var.le_domain
}

resource "aws_route53_record" "sea_to_sky_mx" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = ["1 ${data.aws_route53_zone.sea_to_sky.name}"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_c" {
  name    = "*.${data.aws_route53_zone.sea_to_sky.name}"
  records = [data.aws_route53_zone.sea_to_sky.name]
  ttl     = local.dns_ttl
  type    = "CNAME"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = [aws_instance.droplet.public_ip]
  ttl     = local.dns_ttl
  type    = "A"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a4" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = aws_instance.droplet.ipv6_addresses
  ttl     = local.dns_ttl
  type    = "AAAA"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

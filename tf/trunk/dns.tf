resource "aws_route53_zone" "sea_to_sky" {
  name = var.le_domain
}

resource "aws_route53_record" "mx" {
  name    = "mx.${aws_route53_zone.sea_to_sky.name}"
  records = ["69 ${aws_route53_zone.sea_to_sky.name}"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_c" {
  name    = "*.${aws_route53_zone.sea_to_sky.name}"
  records = [aws_route53_zone.sea_to_sky.name]
  ttl     = local.dns_ttl
  type    = "CNAME"
  zone_id = aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a" {
  name    = aws_route53_zone.sea_to_sky.name
  records = [aws_instance.droplet.public_ip]
  ttl     = local.dns_ttl
  type    = "A"
  zone_id = aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a4" {
  name    = aws_route53_zone.sea_to_sky.name
  records = aws_instance.droplet.ipv6_addresses
  ttl     = local.dns_ttl
  type    = "AAAA"
  zone_id = aws_route53_zone.sea_to_sky.zone_id
}

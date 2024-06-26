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
  records = local.ip_addrs.v4
  ttl     = local.dns_ttl
  type    = "A"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a4" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = local.ip_addrs.v6
  ttl     = local.dns_ttl
  type    = "AAAA"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

output "dns" {
  value = {
    a  = aws_route53_record.sea_to_sky_a.records
    a4 = aws_route53_record.sea_to_sky_a4.records
    c  = aws_route53_record.sea_to_sky_c.records
    mx = aws_route53_record.sea_to_sky_mx.records
  }
}

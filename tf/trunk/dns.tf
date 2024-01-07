resource "aws_route53_zone" "sea_to_sky" {
  name = var.le_domain
}

resource "aws_route53_record" "mx" {
  name    = "mx.${aws_route53_zone.sea_to_sky.name}"
  records = ["69 ${aws_route53_zone.sea_to_sky.name}"]
  ttl     = 60
  type    = "MX"
  zone_id = aws_route53_zone.sea_to_sky.zone_id
}

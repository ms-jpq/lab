resource "aws_route53_zone" "zune" {
  name = var.le_domain
}

resource "aws_route53_record" "mx" {
  name    = "mx.${aws_route53_zone.zune.name}"
  records = [aws_route53_zone.zune.name]
  ttl     = 60
  type    = "MX"
  zone_id = aws_route53_zone.zune.zone_id
}

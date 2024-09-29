data "aws_route53_zone" "limited_void" {
  name = replace(regex("@.+$", var.mail_from), "@", "")
}

locals {
  dns_ttl = 60
}

resource "aws_route53_record" "limited_mx" {
  name    = data.aws_route53_zone.limited_void.name
  records = ["1 ${data.aws_route53_zone.limited_void.name}"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity" "limited_txt" {
  provider = aws.us_e1
  domain   = aws_route53_record.limited_mx.name
}

resource "aws_route53_record" "limited_txt" {
  name    = aws_ses_domain_identity.limited_txt.domain
  records = [aws_ses_domain_identity.limited_txt.verification_token]
  ttl     = local.dns_ttl
  type    = "TXT"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity_verification" "limited_txt" {
  provider = aws.us_e1
  domain   = aws_route53_record.limited_txt.name
}

resource "aws_ses_domain_dkim" "limited_txt" {
  provider = aws.us_e1
  domain   = data.aws_route53_zone.limited_void.name
}

resource "aws_route53_record" "limited_cname" {
  count   = length(aws_ses_domain_dkim.limited_txt.dkim_tokens)
  name    = "${aws_ses_domain_dkim.limited_txt.dkim_tokens[count.index]}._domainkey"
  records = ["${aws_ses_domain_dkim.limited_txt.dkim_tokens[count.index]}.dkim.amazonses.com"]
  ttl     = local.dns_ttl
  type    = "CNAME"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

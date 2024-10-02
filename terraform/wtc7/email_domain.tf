data "aws_route53_zone" "limited_void" {
  name = replace(regex("@.+$", var.mail_from), "@", "")
}

resource "aws_route53_record" "limited_mx" {
  name    = data.aws_route53_zone.limited_void.name
  records = ["10 inbound-smtp.${local.aws_regions.us_e1}.amazonaws.com"]
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

resource "aws_route53_record" "_dmarc" {
  name    = "_dmarc.${data.aws_route53_zone.limited_void.name}"
  records = ["v=DMARC1;p=quarantine;rua=mailto:${local.mail_alert}"]
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
  for_each = toset(aws_ses_domain_dkim.limited_txt.dkim_tokens)
  name     = "${each.key}._domainkey"
  records  = ["${each.key}.dkim.amazonses.com"]
  ttl      = local.dns_ttl
  type     = "CNAME"
  zone_id  = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_sesv2_email_identity" "mta" {
  provider       = aws.us_e1
  for_each       = toset(concat([var.mail_from], var.mail_to))
  email_identity = each.key
}

output "email" {
  value = {
    accounts  = [for id in aws_sesv2_email_identity.mta : id.email_identity],
    domain    = data.aws_route53_zone.limited_void.name,
    mail_from = var.mail_from
    mail_srv  = local.mail_srv
    mail_to   = var.mail_to,
  }
}

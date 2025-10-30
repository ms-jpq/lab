data "aws_route53_zone" "limited_void" {
  name = replace(regex("@.+$", var.mail_from), "@", "")
}

resource "aws_route53_record" "limited_mx" {
  name    = "mail.${data.aws_route53_zone.limited_void.name}"
  records = ["10 inbound-smtp.${local.aws_regions.ca_c1}.amazonaws.com"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity" "limited_txt" {
  domain = aws_route53_record.limited_mx.name
  region = local.aws_regions.ca_c1
}

resource "aws_route53_record" "limited_txt" {
  name    = aws_ses_domain_identity.limited_txt.domain
  records = [aws_ses_domain_identity.limited_txt.verification_token]
  ttl     = local.dns_ttl
  type    = "TXT"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_route53_record" "_dmarc" {
  name    = "_dmarc.${aws_route53_record.limited_mx.name}"
  records = ["v=DMARC1;p=quarantine;rua=mailto:${local.mail_alert}"]
  ttl     = local.dns_ttl
  type    = "TXT"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_dkim" "limited_txt" {
  domain = data.aws_route53_zone.limited_void.name
  region = aws_ses_domain_identity.limited_txt.region
}

resource "aws_sesv2_email_identity" "mta" {
  for_each       = toset(concat([var.mail_from], var.mail_to))
  email_identity = each.key
  region         = aws_ses_domain_identity.limited_txt.region
}

resource "aws_sesv2_email_identity_mail_from_attributes" "mta" {
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
  email_identity         = aws_sesv2_email_identity.mta[var.mail_from].email_identity
  mail_from_domain       = aws_route53_record.limited_mx.name
  region                 = aws_sesv2_email_identity.mta[var.mail_from].region
}

resource "aws_route53_record" "limited_cname" {
  for_each   = toset(aws_ses_domain_dkim.limited_txt.dkim_tokens)
  name       = "${each.key}._domainkey.${aws_route53_record.limited_mx.name}"
  records    = ["${each.key}.dkim.amazonses.com"]
  ttl        = local.dns_ttl
  type       = "CNAME"
  zone_id    = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity_verification" "limited_txt" {
  region = aws_ses_domain_identity.limited_txt.region
  domain = aws_route53_record.limited_txt.name
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

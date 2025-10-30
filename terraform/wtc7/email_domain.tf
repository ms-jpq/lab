data "aws_route53_zone" "limited_void" {
  name = replace(regex("@.+$", var.mail_from), "@", "")
}

resource "aws_sesv2_email_identity" "mta" {
  email_identity = aws_route53_record.limited_mx.name
  region         = local.aws_regions.ca_c1
}

resource "aws_sesv2_email_identity_mail_from_attributes" "mta" {
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
  email_identity         = aws_sesv2_email_identity.mta.email_identity
  mail_from_domain       = "mail.${aws_route53_record.limited_mx.name}"
  region                 = aws_sesv2_email_identity.mta.region
}

resource "aws_route53_record" "limited_mx" {
  name    = aws_sesv2_email_identity_mail_from_attributes.mta.mail_from_domain
  records = ["10 inbound-smtp.${local.aws_regions.ca_c1}.amazonaws.com"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_route53_record" "_dmarc" {
  name    = "_dmarc.${aws_route53_record.limited_mx.zone_id}"
  records = ["v=DMARC1;p=quarantine;rua=mailto:${local.mail_alert}"]
  ttl     = local.dns_ttl
  type    = "TXT"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_route53_record" "dkim" {
  for_each = aws_sesv2_email_identity.mta.dkim_signing_attributes
  name     = each.value.domain_signing_selector
  records  = each.value.tokens
  ttl      = local.dns_ttl
  type     = "CNAME"
  zone_id  = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_sesv2_email_identity" "mda" {
  for_each       = toset(concat([var.mail_from], var.mail_to))
  email_identity = each.key
  region         = aws_sesv2_email_identity.mta.region
}

output "email" {
  value = {
    accounts  = [for id in aws_sesv2_email_identity.mda : id.email_identity],
    domain    = data.aws_route53_zone.limited_void.name,
    mail_from = var.mail_from
    mail_srv  = local.mail_srv
    mail_to   = var.mail_to,
  }
}

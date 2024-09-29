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

resource "aws_ses_receipt_rule_set" "maildir" {
  provider      = aws.us_e1
  rule_set_name = "maildir"
}

resource "aws_ses_receipt_rule" "maildir" {
  provider      = aws.us_e1
  depends_on    = [aws_sqs_queue_policy.qq]
  name          = "maildir"
  rule_set_name = aws_ses_receipt_rule_set.maildir.rule_set_name

  add_header_action {
    header_name  = "X-Mail-To"
    header_value = urlencode(var.mail_to)
    position     = 0
  }
  s3_action {
    bucket_name = aws_s3_bucket.maildir.id
    position    = 1
  }
}

resource "aws_s3_bucket_notification" "maildir" {
  provider   = aws.us_e1
  depends_on = [aws_sqs_queue_policy.qq]
  bucket     = aws_s3_bucket.maildir.id

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.mbox.arn
  }
}

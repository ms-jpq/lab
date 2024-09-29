resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
}

resource "aws_sqs_queue" "maildir" {
}
resource "aws_sqs_queue" "dns" {
}

data "aws_iam_policy_document" "mta" {
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["arn:aws:logs:*:*:*"]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = ["arn:aws:sqs:*:*:${aws_sqs_queue.maildir.name}"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    effect    = "Allow"
    resources = ["arn:aws:s3:*:*:${aws_s3_bucket.maildir.bucket}/*"]
  }
  statement {
    actions   = ["ses:SendRawEmail"]
    effect    = "Allow"
    resources = ["/*"]
  }
}

data "aws_iam_policy_document" "maildir" {
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    effect    = "Allow"
    resources = ["arn:aws:s3:*:*:${aws_s3_bucket.maildir.bucket}/*"]
  }

  statement {
    effect = "Allow"

    actions   = ["sqs:SendMessage"]
    resources = ["arn:aws:sqs:*:*:${aws_sqs_queue.maildir.name}"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.maildir.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "qq" {
  queue_url = aws_sqs_queue.maildir.arn
  policy    = data.aws_iam_policy_document.maildir.json
}

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

resource "aws_ses_receipt_rule_set" "router1" {
  provider      = aws.us_e1
  rule_set_name = "router1"
}

resource "aws_ses_receipt_rule" "s3" {
  provider      = aws.us_e1
  name          = "s3"
  rule_set_name = aws_ses_receipt_rule_set.router1.rule_set_name

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
  bucket = aws_s3_bucket.maildir.id

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.maildir.arn
  }
}

resource "aws_iam_role" "mta" {
  assume_role_policy = data.aws_iam_policy_document.mta.json
}

data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/mta"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  architectures    = ["arm64"]
  filename         = data.archive_file.mta.output_path
  function_name    = basename(data.archive_file.mta.source_dir)
  handler          = "handler"
  role             = aws_iam_role.mta.arn
  runtime          = "python3.12"
  source_code_hash = data.archive_file.mta.output_base64sha256
}

resource "aws_lambda_function_event_invoke_config" "dns" {
  function_name = aws_lambda_function.mta.function_name

  destination_config {
    on_failure {
      destination = aws_sqs_queue.dns.arn
    }
  }
}

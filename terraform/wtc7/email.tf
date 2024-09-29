resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
}

resource "aws_sqs_queue" "mbox" {
  provider = aws.us_e1
}

resource "aws_sqs_queue" "dns" {
  provider = aws.us_e1
}

data "aws_iam_policy_document" "mbox" {
  statement {
    actions   = ["s3:PutObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    effect    = "Allow"
    resources = [aws_sqs_queue.mbox.arn]

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

resource "aws_sqs_queue_policy" "mbox" {
  provider  = aws.us_e1
  queue_url = aws_sqs_queue.mbox.id
  policy    = data.aws_iam_policy_document.mbox.json
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

resource "aws_ses_receipt_rule_set" "maildir" {
  provider      = aws.us_e1
  rule_set_name = "maildir"
}

data "aws_iam_policy_document" "maildir" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.maildir.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_ses_receipt_rule_set.maildir.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "maildir" {
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id
  policy   = data.aws_iam_policy_document.maildir.json
}

resource "aws_ses_receipt_rule" "maildir" {
  provider      = aws.us_e1
  depends_on    = [aws_s3_bucket_policy.maildir]
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
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.mbox.arn
  }
}

data "aws_iam_policy_document" "mta" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "port_auth" {
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["arn:aws:logs:::"]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.mbox.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
  statement {
    actions   = ["ses:SendRawEmail"]
    effect    = "Allow"
    resources = ["*"]
  }
}

resource "aws_iam_role" "mta" {
  assume_role_policy = data.aws_iam_policy_document.mta.json
}

resource "aws_iam_policy" "port_auth" {
  policy = data.aws_iam_policy_document.port_auth.json
}

resource "aws_iam_role_policy_attachment" "port_auth" {
  role       = aws_iam_role.mta.name
  policy_arn = aws_iam_policy.port_auth.arn
}

data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/mta"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  provider         = aws.us_e1
  architectures    = ["arm64"]
  filename         = data.archive_file.mta.output_path
  function_name    = basename(data.archive_file.mta.source_dir)
  handler          = "handler"
  role             = aws_iam_role.mta.arn
  runtime          = "python3.12"
  source_code_hash = data.archive_file.mta.output_base64sha256
}

data "aws_iam_policy_document" "dns" {
  statement {
    actions   = ["sqs:SendMessage"]
    effect    = "Allow"
    resources = [aws_sqs_queue.dns.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_lambda_function.mta.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "dns" {
  provider  = aws.us_e1
  queue_url = aws_sqs_queue.dns.id
  policy    = data.aws_iam_policy_document.dns.json
}

resource "aws_lambda_function_event_invoke_config" "mta" {
  provider      = aws.us_e1
  depends_on    = [aws_sqs_queue_policy.dns]
  function_name = aws_lambda_function.mta.function_name

  destination_config {
    on_failure {
      destination = aws_sqs_queue.dns.arn
    }
  }
}

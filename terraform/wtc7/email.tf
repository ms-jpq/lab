resource "aws_s3_bucket" "maildir" {
  bucket = "kfc-maildir"
}

resource "aws_sns_topic" "maildir" {
}

resource "aws_sqs_queue" "dns" {
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

  # statement {
  #   actions = ["s3:*"]
  #   effect  = "Allow"
  #   resources = flatten([
  #     for bucket in [aws_s3_bucket.maildir.bucket] : [
  #       "arn:aws:s3:::${bucket}/*"
  #   ]])
  # }
}

resource "aws_iam_role" "mta" {
  name               = "mta"
  assume_role_policy = data.aws_iam_policy_document.mta.json
}

# data "aws_iam_role" "cloud_watch" {
#   name = "AWSLambdaBasicExecutionRole"
# }

resource "aws_iam_role_policy_attachment" "mta" {
  for_each   = toset(["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole", "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"])
  policy_arn = each.key
  role       = aws_iam_role.mta.name
}

data "aws_route53_zone" "limited_void" {
  name = replace(regex("@.+$", var.mail_from), "@", "")
}

locals {
  dns_ttl = 60
}

resource "aws_route53_record" "limited_mx" {
  provider = aws.us_e1
  name     = data.aws_route53_zone.limited_void.name
  records  = ["1 ${data.aws_route53_zone.limited_void.name}"]
  ttl      = local.dns_ttl
  type     = "MX"
  zone_id  = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity" "limited_txt" {
  provider = aws.us_e1
  domain   = aws_route53_record.limited_mx.name
}

resource "aws_route53_record" "limited_txt" {
  provider = aws.us_e1
  name     = aws_ses_domain_identity.limited_txt.domain
  records  = [aws_ses_domain_identity.limited_txt.verification_token]
  ttl      = local.dns_ttl
  type     = "TXT"
  zone_id  = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity_verification" "limited_txt" {
  provider = aws.us_e1
  domain   = aws_route53_record.limited_txt.name
}

resource "aws_ses_receipt_rule_set" "router1" {
  rule_set_name = "router1"
}

resource "aws_ses_receipt_rule" "s3" {
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

  topic {
    events    = ["s3:ObjectCreated:*"]
    topic_arn = aws_sns_topic.maildir.arn
  }
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

resource "aws_lambda_permission" "mta" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mta.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.maildir.arn
}

resource "aws_lambda_function_event_invoke_config" "dns" {
  function_name = aws_lambda_function.mta.function_name

  depends_on = [aws_iam_role_policy_attachment.mta]
  destination_config {
    on_failure {
      destination = aws_sqs_queue.dns.arn
    }
  }
}

resource "aws_sns_topic_subscription" "maildir" {
  endpoint  = aws_lambda_function.mta.arn
  protocol  = "lambda"
  topic_arn = aws_sns_topic.maildir.arn
}

data "aws_s3_bucket" "maildir" {
  bucket = "kfc-mailbox"
  region = local.lambda_region
}

data "aws_iam_policy_document" "maildir" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.sink.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [data.aws_s3_bucket.maildir.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "maildir" {
  policy    = data.aws_iam_policy_document.maildir.json
  queue_url = aws_sqs_queue.sink.id
  region    = aws_sqs_queue.sink.region
}

resource "aws_s3_bucket_notification" "maildir" {
  bucket     = data.aws_s3_bucket.maildir.bucket
  region     = aws_sqs_queue_policy.maildir.region

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.sink.arn
  }
}

variable "email_alert" {
  sensitive = true
  type      = string
}

variable "mail_user" {
  sensitive = true
  type      = string
}

variable "mail_pass" {
  sensitive = true
  type      = string
}

variable "mail_filter" {
  sensitive = true
  type      = string
}

data "aws_iam_policy_document" "mta" {
  statement {
    actions   = ["sns:Publish"]
    effect    = "Allow"
    resources = [aws_sns_topic.siphon.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    effect    = "Allow"
    resources = ["${data.aws_s3_bucket.maildir.arn}/*"]
  }
}

resource "aws_lambda_function" "mta" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.nop.output_path
  function_name    = "mta"
  handler          = "faas.mta.main"
  layers           = local.lambda_layers
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["mta"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.nop.output_base64sha256
  timeout          = 6

  environment {
    variables = merge(
      local.lambda_envs,
      {
        MAIL_FROM = var.mail_from
        MAIL_TO   = join(", ", var.mail_to)
        MAIL_SRV  = local.mail_srv
        MAIL_USER = var.mail_user
        MAIL_PASS = var.mail_pass
        MAIL_FILT = var.mail_filter
      }
    )
  }
}

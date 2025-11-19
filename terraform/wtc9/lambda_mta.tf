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

data "aws_s3_bucket" "maildir" {
  bucket = "kfc-mailbox"
  region = local.lambda_region
}

data "aws_iam_policy_document" "port_auth" {
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
  filename         = data.archive_file.haskell.output_path
  function_name    = "mta"
  handler          = "faas.mta.main"
  layers           = local.lambda_layers
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["mta"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256
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

resource "aws_lambda_function_event_invoke_config" "mta" {
  for_each               = local.lambda_failures
  function_name          = each.value
  maximum_retry_attempts = 1
  region                 = aws_sns_topic.siphon.region

  destination_config {
    on_failure {
      destination = aws_sns_topic.siphon.arn
    }
  }
}

resource "aws_s3_bucket_notification" "maildir" {
  depends_on = [aws_lambda_permission.faas["mta"]]
  bucket     = data.aws_s3_bucket.maildir.bucket
  region     = data.aws_s3_bucket.maildir.region

  lambda_function {
    events              = ["s3:ObjectCreated:*"]
    lambda_function_arn = aws_lambda_function.mta.arn
  }
}

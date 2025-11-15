locals {
  lambda_region = local.aws_regions.ca_c1
}

data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.mta.output_path
  function_name    = "mta"
  handler          = "mta.fax"
  layers           = local.lambda_layers
  region           = local.lambda_region
  role             = aws_iam_role.mta.arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.mta.output_base64sha256
  timeout          = local.timeouts.lambda

  environment {
    variables = {
      MAIL_FROM = var.mail_from
      MAIL_TO   = join(", ", var.mail_to)
      MAIL_SRV  = local.mail_srv
      MAIL_USER = var.mail_user
      MAIL_PASS = var.mail_pass
      MAIL_FILT = var.mail_filter
    }
  }
}

resource "aws_lambda_function_event_invoke_config" "mta" {
  function_name          = aws_lambda_function.mta.function_name
  maximum_retry_attempts = local.retries.lambda
  region                 = aws_lambda_function.mta.region

  destination_config {
    on_failure {
      destination = aws_sns_topic.sink.arn
    }
  }
}

resource "aws_cloudwatch_log_group" "mta" {
  name              = "/aws/lambda/${aws_lambda_function.mta.function_name}"
  region            = aws_lambda_function.mta.region
  retention_in_days = 1
}

output "logging" {
  value = "aws --region ${aws_lambda_function.mta.region} logs tail ${aws_cloudwatch_log_group.mta.name} --follow"
}

output "local_exec" {
  value = "denv ./facts/.env python3 -m terraform.wtc7.lambdas.mta --mail-srv ${local.mail_srv} --mail-to '<mail-to>'"
}

locals {
  lambda_rt    = "python3.12"
  lambda_arch  = "arm64"
  lambda_layer = "arn:aws:lambda:us-east-1:017000801446:layer:AWSLambdaPowertoolsPythonV3-${replace(local.lambda_rt, ".", "")}-${local.lambda_arch}:1"
}

data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/mta"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  provider         = aws.us_e1
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.mta.output_path
  function_name    = basename(data.archive_file.mta.source_dir)
  handler          = "mta.main"
  layers           = [local.lambda_layer]
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
    }
  }
}

resource "aws_lambda_function_event_invoke_config" "mta" {
  provider               = aws.us_e1
  function_name          = aws_lambda_function.mta.function_name
  maximum_retry_attempts = local.retries.lambda

  destination_config {
    on_failure {
      destination = aws_sns_topic.sink.arn
    }
  }
}

resource "aws_cloudwatch_log_group" "mta" {
  provider          = aws.us_e1
  name              = "/aws/lambda/${aws_lambda_function.mta.function_name}"
  retention_in_days = 1
}

output "logging" {
  value = "aws --region ${local.aws_regions.us_e1} logs tail ${aws_cloudwatch_log_group.mta.name} --follow"
}

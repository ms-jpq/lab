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
      MAIL_TO   = var.mail_to
      MAIL_SRV  = local.mail_srv
      MAIL_USER = var.mail_user
      MAIL_PASS = var.mail_pass
    }
  }
}

resource "aws_lambda_event_source_mapping" "mta" {
  provider                           = aws.us_e1
  event_source_arn                   = aws_sqs_queue.mbox.arn
  function_name                      = aws_lambda_function.mta.arn
  maximum_batching_window_in_seconds = 3
}

resource "aws_lambda_event_source_mapping" "sink" {
  provider                           = aws.us_e1
  event_source_arn                   = aws_sqs_queue.sink.arn
  function_name                      = aws_lambda_function.mta.arn
  maximum_batching_window_in_seconds = local.timeouts.batching
}

resource "aws_cloudwatch_log_group" "mta" {
  provider          = aws.us_e1
  name              = "/aws/lambda/${aws_lambda_function.mta.function_name}"
  retention_in_days = 1
}

output "logging" {
  value = "aws --region ${local.aws_regions.us_e1} logs tail ${aws_cloudwatch_log_group.mta.name} --follow"
}

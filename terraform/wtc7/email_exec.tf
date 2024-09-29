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
  handler          = "main"
  layers           = [local.lambda_layer]
  role             = aws_iam_role.mta.arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.mta.output_base64sha256
  timeout          = local.timeouts.lambda
}

resource "aws_lambda_event_source_mapping" "mta" {
  provider         = aws.us_e1
  event_source_arn = aws_sqs_queue.mbox.arn
  function_name    = aws_lambda_function.mta.arn
}

resource "aws_cloudwatch_event_rule" "cron" {
  provider            = aws.us_e1
  schedule_expression = "rate(60 minutes)"
}

resource "aws_cloudwatch_event_target" "cron" {
  provider = aws.us_e1
  arn      = aws_lambda_function.mta.arn
  rule     = aws_cloudwatch_event_rule.cron.name

  dead_letter_config {
    arn = aws_sqs_queue.sink.arn
  }
}

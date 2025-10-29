resource "aws_lambda_function" "cron" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "cron"
  handler          = "cron.main"
  layers           = [local.lambda_layer]
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["cron"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_cloudwatch_event_rule" "cron" {
  region              = aws_lambda_function.cron.region
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "lambda_target" {
  arn    = aws_lambda_function.cron.arn
  region = aws_lambda_function.cron.region
  rule   = aws_cloudwatch_event_rule.cron.name
}

resource "aws_lambda_permission" "allow_eventbridge" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.cron.function_name
  principal     = "events.amazonaws.com"
  region        = aws_lambda_function.cron.region
  source_arn    = aws_cloudwatch_event_rule.cron.arn
}

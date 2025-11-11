resource "aws_lambda_function" "cron" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "cron"
  handler          = "faas.cron.main"
  layers           = local.lambda_layers
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["cron"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_iam_role" "cron" {
  assume_role_policy = data.aws_iam_policy_document.allow_event_bridge.json
}

resource "aws_scheduler_schedule" "cron" {
  region              = aws_lambda_function.cron.region
  schedule_expression = "rate(1 hours)"

  flexible_time_window {
    maximum_window_in_minutes = 15
    mode                      = "FLEXIBLE"
  }
  target {
    arn      = aws_lambda_function.cron.arn
    role_arn = aws_iam_role.cron.arn
  }
}

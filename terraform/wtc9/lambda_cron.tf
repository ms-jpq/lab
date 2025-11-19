variable "miniflux_endpoint" {
  sensitive = true
  type      = string
}

variable "miniflux_key" {
  sensitive = true
  type      = string
}

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
    variables = merge(
      local.lambda_envs,
      {
        ENV_MINIFLUX_ENDPOINT = var.miniflux_endpoint
        ENV_MINIFLUX_KEY      = var.miniflux_key
      }
    )
  }
}

resource "aws_cloudwatch_event_rule" "cron" {
  region              = aws_lambda_function.cron.region
  schedule_expression = "rate(1 hour)"
}

resource "aws_cloudwatch_event_target" "cron" {
  arn    = aws_lambda_function.cron.arn
  region = aws_cloudwatch_event_rule.cron.region
  rule   = aws_cloudwatch_event_rule.cron.id
}

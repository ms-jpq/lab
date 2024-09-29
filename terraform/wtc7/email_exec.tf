data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/mta"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  provider         = aws.us_e1
  architectures    = ["arm64"]
  filename         = data.archive_file.mta.output_path
  function_name    = basename(data.archive_file.mta.source_dir)
  handler          = "main"
  role             = aws_iam_role.mta.arn
  runtime          = "python3.12"
  source_code_hash = data.archive_file.mta.output_base64sha256
}

resource "aws_lambda_function_event_invoke_config" "mta" {
  provider      = aws.us_e1
  depends_on    = [aws_sqs_queue_policy.dns]
  function_name = aws_lambda_function.mta.function_name

  destination_config {
    on_failure {
      destination = aws_sqs_queue.dns.arn
    }
  }
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
    arn = aws_sqs_queue.dns.arn
  }
}

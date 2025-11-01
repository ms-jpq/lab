resource "aws_sqs_queue" "sink" {
  region = aws_apigatewayv2_api.faas.region
}

resource "aws_sqs_queue" "drain" {
  region = aws_sqs_queue.sink.region
}

resource "aws_sqs_queue_redrive_allow_policy" "pipe" {
  queue_url = aws_sqs_queue.drain.id
  region    = aws_sqs_queue.drain.region

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.sink.arn]
  })
}

resource "aws_sqs_queue_redrive_policy" "pipe" {
  queue_url = aws_sqs_queue.sink.id
  region    = aws_sqs_queue.sink.region

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.drain.arn
    maxReceiveCount     = 2
  })
}

data "aws_iam_policy_document" "skyhook" {
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
}

resource "aws_lambda_function" "skyhook" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "skyhook"
  handler          = "skyhook.main"
  layers           = [local.lambda_layer]
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["skyhook"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_lambda_event_source_mapping" "skyhook" {
  event_source_arn = aws_sqs_queue.sink.arn
  function_name    = aws_lambda_function.skyhook.arn
  region           = aws_lambda_function.skyhook.region
}

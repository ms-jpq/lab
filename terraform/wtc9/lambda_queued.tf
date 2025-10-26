data "aws_iam_policy_document" "skyhook" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["${aws_cloudwatch_log_group.skyhook.arn}:*"]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
}

resource "aws_iam_role" "skyhook" {
  provider           = aws.ca_w1
  assume_role_policy = data.aws_iam_policy_document.allow_lambda.json
}

resource "aws_iam_policy" "skyhook" {
  provider = aws.ca_w1
  policy   = data.aws_iam_policy_document.skyhook.json
}

resource "aws_iam_role_policy_attachment" "skyhook" {
  provider   = aws.ca_w1
  role       = aws_iam_role.skyhook.name
  policy_arn = aws_iam_policy.skyhook.arn
}

resource "aws_lambda_function" "skyhook" {
  provider         = aws.ca_w1
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "skyhook"
  handler          = "skyhook.entry.main"
  layers           = [local.lambda_layer]
  role             = aws_iam_role.skyhook.arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_lambda_event_source_mapping" "skyhook" {
  provider         = aws.ca_w1
  event_source_arn = aws_sqs_queue.sink.arn
  function_name    = aws_lambda_function.skyhook.arn
}

resource "aws_cloudwatch_log_group" "skyhook" {
  provider          = aws.ca_w1
  name              = "/aws/lambda/${aws_lambda_function.skyhook.function_name}"
  retention_in_days = 1
}

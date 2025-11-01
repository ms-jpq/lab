data "aws_iam_policy_document" "skycrane" {
  statement {
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
  # statement {
  #   actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem","dynamodb:BatchWriteItem"]
  #   effect    = "Allow"
  #   resources = []
  # }
}

resource "aws_lambda_function" "ppv" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "ppv"
  handler          = "ppv.main"
  layers           = [local.lambda_layer]
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["ppv"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {
      ENV_ARCHIVE         = null
      ENV_DOMAIN          = var.vps_domain
      ENV_TWILIO_REDIRECT = var.twilio_redirect
      ENV_TWILIO_TOKEN    = var.twilio_token
    }
  }
}

resource "aws_apigatewayv2_integration" "ppv" {
  api_id                 = aws_apigatewayv2_api.faas.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ppv.invoke_arn
  payload_format_version = "2.0"
  region                 = aws_apigatewayv2_api.faas.region
}

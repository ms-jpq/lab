resource "aws_dynamodb_table" "mango" {
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "ID"
  name         = "mango_db"
  region       = aws_sqs_queue.sink.region

  attribute {
    name = "ID"
    type = "S"
  }
  ttl {
    attribute_name = "TTL"
    enabled        = true
  }
}

data "aws_iam_policy_document" "skycrane" {
  statement {
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
  statement {
    actions = [
      "dynamodb:BatchWriteItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    effect    = "Allow"
    resources = [aws_dynamodb_table.mango.arn]
  }
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
      ENV_DOMAIN           = var.vps_domain
      ENV_TBL_NAME         = aws_dynamodb_table.mango.name
      ENV_TWILIO_REDIRECTS = jsonencode(var.twilio_redirects)
      ENV_TWILIO_TOKEN     = var.twilio_token
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

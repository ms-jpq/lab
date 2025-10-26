resource "aws_lambda_function" "okta" {
  provider         = aws.ca_w1
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "okta"
  handler          = "okta.entry.main"
  layers           = [local.lambda_layer]
  role             = aws_iam_role.lambdas.okta.arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_lambda_permission" "okta" {
  provider      = aws.ca_w1
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.okta.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.faas.execution_arn}/*"
  statement_id  = "AllowAPIGatewayInvoke"
}

resource "aws_apigatewayv2_authorizer" "okta" {
  provider                          = aws.ca_w1
  api_id                            = aws_apigatewayv2_api.faas.id
  authorizer_payload_format_version = "2.0"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.okta.invoke_arn
  enable_simple_responses           = true
  name                              = aws_lambda_function.okta.function_name
}

resource "aws_cloudwatch_log_group" "okta" {
  provider          = aws.ca_w1
  name              = "/aws/lambda/${aws_lambda_function.okta.function_name}"
  retention_in_days = 1
}

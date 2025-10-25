resource "aws_lambda_function" "okta" {
  filename      = "authorizer.zip"
  function_name = "api-authorizer"
  handler       = "index.lambda_handler"
  role          = aws_iam_role.lambda_role.arn
}

resource "aws_lambda_permission" "okta" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.okta.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
  statement_id  = "AllowAPIGatewayInvoke"
}

resource "aws_apigatewayv2_authorizer" "okta" {
  api_id                            = aws_apigatewayv2_api.funnel.id
  authorizer_payload_format_version = "2.0"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.okta.invoke_arn
  enable_simple_responses           = true
  name                              = aws_lambda_function.okta.function_name
}

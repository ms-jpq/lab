resource "aws_lambda_function" "okta" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "okta"
  handler          = "faas.okta.main"
  layers           = [local.lambda_layer]
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["okta"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_apigatewayv2_authorizer" "okta" {
  api_id                            = aws_apigatewayv2_api.faas.id
  authorizer_payload_format_version = "2.0"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.okta.invoke_arn
  enable_simple_responses           = true
  name                              = aws_lambda_function.okta.function_name
  region                            = local.lambda_region
}

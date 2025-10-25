locals {
  lambda_rt    = "python3.12"
  lambda_arch  = "arm64"
  lambda_layer = "arn:aws:lambda:us-east-1:017000801446:layer:AWSLambdaPowertoolsPythonV3-${replace(local.lambda_rt, ".", "")}-${local.lambda_arch}:1"
}

data "archive_file" "okta" {
  output_path = "${path.module}/../../var/okta.zip"
  source_dir  = "${path.module}/okta"
  type        = "zip"
}

resource "aws_lambda_function" "okta" {
  provider         = aws.ca_w1
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.okta.output_path
  function_name    = basename(data.archive_file.okta.source_dir)
  handler          = "mda.lambda.main"
  layers           = [local.lambda_layer]
  role             = aws_iam_role.okta.arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.okta.output_base64sha256
  timeout          = local.timeouts.lambda

  environment {
    variables = {}
  }
}

resource "aws_lambda_permission" "okta" {
  provider      = aws.ca_w1
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.okta.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.funnel.execution_arn}/*/*"
  statement_id  = "AllowAPIGatewayInvoke"
}

resource "aws_apigatewayv2_authorizer" "okta" {
  provider                          = aws.ca_w1
  api_id                            = aws_apigatewayv2_api.funnel.id
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

output "logging" {
  value = "aws --region ${local.aws_regions.ca_w1} logs tail ${aws_cloudwatch_log_group.okta.name} --follow"
}

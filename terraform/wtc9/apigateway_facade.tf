resource "aws_apigatewayv2_api" "faas" {
  provider      = aws.ca_w1
  name          = "faas"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  provider    = aws.ca_w1
  api_id      = aws_apigatewayv2_api.faas.id
  auto_deploy = true
  name        = "$default"
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.faas.api_endpoint
  }
}

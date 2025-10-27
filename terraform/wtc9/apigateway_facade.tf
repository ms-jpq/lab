resource "aws_apigatewayv2_api" "faas" {
  name          = "faas"
  protocol_type = "HTTP"
  region        = local.aws_regions.ca_w1
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  api_id      = aws_apigatewayv2_api.faas.id
  auto_deploy = true
  name        = "$default"
  region      = aws_apigatewayv2_api.faas.region
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.faas.api_endpoint
  }
}

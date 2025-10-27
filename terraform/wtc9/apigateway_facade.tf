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

locals {
  api_gateway_routes = {
    "$default"               = { integration = aws_apigatewayv2_integration.ppv }
    "ANY /webhooks"          = { integration = aws_apigatewayv2_integration.sink }
    "ANY /webhooks/{proxy+}" = { integration = aws_apigatewayv2_integration.sink }
  }
}

resource "aws_apigatewayv2_route" "umbrella" {
  for_each           = local.api_gateway_routes
  region             = aws_apigatewayv2_api.faas.region
  api_id             = aws_apigatewayv2_api.faas.id
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.okta.id
  route_key          = each.key
  target             = "integrations/${each.value.integration.id}"
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.faas.api_endpoint
  }
}

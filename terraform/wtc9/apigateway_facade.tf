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
  dns_ttl = 60
  api_gateway_routes = {
    "$default" = {
      integration = aws_apigatewayv2_integration.ppv,
      authorizer  = null
    }
    "ANY /webhooks" = {
      integration = aws_apigatewayv2_integration.sink,
      authorizer  = aws_apigatewayv2_authorizer.okta.id
    }
    "ANY /webhooks/{proxy+}" = {
      integration = aws_apigatewayv2_integration.sink,
      authorizer  = aws_apigatewayv2_authorizer.okta.id
    }
  }
}

resource "aws_apigatewayv2_route" "umbrella" {
  for_each           = local.api_gateway_routes
  region             = aws_apigatewayv2_api.faas.region
  api_id             = aws_apigatewayv2_api.faas.id
  authorization_type = each.value.authorizer != null ? "CUSTOM" : "NONE"
  authorizer_id      = each.value.authorizer
  route_key          = each.key
  target             = "integrations/${each.value.integration.id}"
}

data "aws_route53_zone" "limited_void" {
  name = var.faas_domain
}

resource "aws_acm_certificate" "fascia" {
  domain_name       = "faas.${data.aws_route53_zone.limited_void.name}"
  region            = aws_apigatewayv2_api.faas.region
  validation_method = "DNS"
}

locals {
  endpoint_domain = regex("\\w+://(.*)", aws_apigatewayv2_api.faas.api_endpoint)[0]
}

resource "aws_route53_record" "fascia" {
  name    = aws_acm_certificate.fascia.domain_name
  records = [local.endpoint_domain]
  ttl     = local.dns_ttl
  type    = "CNAME"
  zone_id = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_route53_record" "limited_void" {
  for_each = { for dvo in aws_acm_certificate.fascia.domain_validation_options : dvo.domain_name => dvo }
  name     = each.value.resource_record_name
  records  = [each.value.resource_record_value]
  ttl      = local.dns_ttl
  type     = each.value.resource_record_type
  zone_id  = data.aws_route53_zone.limited_void.zone_id
}

resource "aws_acm_certificate_validation" "limited_void" {
  certificate_arn         = aws_acm_certificate.fascia.arn
  region                  = aws_acm_certificate.fascia.region
  validation_record_fqdns = [for record in aws_route53_record.limited_void : record.fqdn]
}

resource "aws_apigatewayv2_domain_name" "fascia" {
  domain_name = aws_acm_certificate.fascia.domain_name
  region      = aws_apigatewayv2_api.faas.region

  domain_name_configuration {
    certificate_arn = aws_acm_certificate.fascia.arn
    endpoint_type   = "REGIONAL"
    ip_address_type = "dualstack"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "fascia" {
  api_id      = aws_apigatewayv2_api.faas.id
  domain_name = aws_apigatewayv2_domain_name.fascia.domain_name
  region      = aws_apigatewayv2_api.faas.region
  stage       = aws_apigatewayv2_stage.one_wtc.name
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.faas.api_endpoint
  }
}

resource "aws_apigatewayv2_api" "faas" {
  ip_address_type = "dualstack"
  name            = "faas"
  protocol_type   = "HTTP"
  region          = local.aws_regions.ca_w1
}

locals {
  dns_ttl = 60
}

resource "aws_apigatewayv2_route" "umbrella" {
  region    = aws_apigatewayv2_api.faas.region
  api_id    = aws_apigatewayv2_api.faas.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ppv.id}"
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  api_id      = aws_apigatewayv2_api.faas.id
  auto_deploy = true
  name        = "$default"
  region      = aws_apigatewayv2_api.faas.region

  default_route_settings {
    throttling_burst_limit = 6
    throttling_rate_limit  = 2
  }
}

data "aws_route53_zone" "limited_void" {
  name = var.faas_domain
}

resource "aws_acm_certificate" "fascia" {
  domain_name       = "faas.${data.aws_route53_zone.limited_void.name}"
  region            = aws_apigatewayv2_api.faas.region
  validation_method = "DNS"
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

resource "aws_route53_record" "fascia" {
  for_each = toset(["A", "AAAA"])
  name     = aws_apigatewayv2_api_mapping.fascia.domain_name
  type     = each.key
  zone_id  = data.aws_route53_zone.limited_void.zone_id

  alias {
    evaluate_target_health = false
    name                   = aws_apigatewayv2_domain_name.fascia.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.fascia.domain_name_configuration[0].hosted_zone_id
  }
}

output "apigateway" {
  value = {
    endpoint = "https://${aws_apigatewayv2_api_mapping.fascia.domain_name}"
  }
}

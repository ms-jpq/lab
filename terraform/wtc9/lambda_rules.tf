variable "vps_domain" {
  type = string
}

variable "faas_domain" {
  type = string
}

variable "twilio_redirects" {
  sensitive = true
  type      = list(string)
}

variable "twilio_token" {
  sensitive = true
  type      = string
}

locals {
  lambda_region = aws_apigatewayv2_api.faas.region
  lambda_cron_jobs = {
    miniflux = { schedule = "rate(1 hour)", input = { label = "miniflux" } }
  }
  lambda_functions = {
    cron    = { policies = [data.aws_iam_policy_document.siphon] }
    okta    = { policies = [] }
    ppv     = { policies = [data.aws_iam_policy_document.skycrane] }
    skyhook = { policies = [data.aws_iam_policy_document.siphon, data.aws_iam_policy_document.skyhook] }
  }
  lambda_permissions = {
    cron = concat([for key, val in local.lambda_cron_jobs : { principal = "events.amazonaws.com", source_arn = aws_cloudwatch_event_rule.cron[key].arn }])
    okta = [{ principal = "apigateway.amazonaws.com", source_arn = "${aws_apigatewayv2_api.faas.execution_arn}/*" }]
    ppv  = [{ principal = "apigateway.amazonaws.com", source_arn = "${aws_apigatewayv2_api.faas.execution_arn}/*" }]
  }
}

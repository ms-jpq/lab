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
  lambda_functions = {
    cron    = { policies = [] }
    mta     = { policies = [data.aws_iam_policy_document.port_auth] }
    okta    = { policies = [] }
    ppv     = { policies = [data.aws_iam_policy_document.skycrane] }
    skyhook = { policies = [data.aws_iam_policy_document.skyhook] }
  }
  lambda_permissions = {
    okta = { principal = "apigateway.amazonaws.com", source_arn = "${aws_apigatewayv2_api.faas.execution_arn}/*" }
    ppv  = { principal = "apigateway.amazonaws.com", source_arn = "${aws_apigatewayv2_api.faas.execution_arn}/*" }
    cron = { principal = "events.amazonaws.com", source_arn = aws_scheduler_schedule.cron.arn }
    mta  = { principal = "" , source_arn = "" }
  }
}

data "archive_file" "haskell" {
  output_path = "${path.module}/../../var/faas.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

variable "vps_domain" {
  type = string
}

variable "faas_domain" {
  type = string
}

variable "twilio_redirect" {
  type = string
}

variable "twilio_token" {
  type = string
}

locals {
  lambda_region = aws_apigatewayv2_api.faas.region
  lambda_functions = {
    cron    = { policies = [] }
    ppv     = { policies = [data.aws_iam_policy_document.skycrane] }
    skyhook = { policies = [data.aws_iam_policy_document.skyhook] }
  }
}

data "archive_file" "haskell" {
  output_path = "${path.module}/../../var/faas.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

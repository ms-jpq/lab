variable "otlp_endpoint" {
  sensitive = true
  type      = string
}

data "archive_file" "nop" {
  output_path = "${path.module}/../../var/nop.zip"
  source_dir  = "${path.module}/lambdas/nop"
  type        = "zip"
}

data "archive_file" "haskell" {
  output_path = "${path.module}/../../var/faas.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

resource "aws_lambda_layer_version" "haskell" {
  filename   = data.archive_file.haskell.output_path
  layer_name = "faas-${data.archive_file.haskell.output_sha256}"
  region     = local.lambda_region

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  # https://docs.aws.amazon.com/powertools/python/latest/#lambda-layer
  # https://github.com/open-telemetry/opentelemetry-lambda/blob/main/python/src/otel/otel_sdk/requirements.txt
  lambda_rt   = "python3.14"
  lambda_arch = "arm64"
  lambda_powertool_version = 27
  lambda_layers = [
    "arn:aws:lambda:${local.lambda_region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-${replace(local.lambda_rt, ".", "")}-${local.lambda_arch}:${local.lambda_powertool_version}",
    "arn:aws:lambda:${local.lambda_region}:184161586896:layer:opentelemetry-python-0_17_0:1",
    aws_lambda_layer_version.haskell.arn,
  ]
  lambda_envs = {
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otlp_endpoint
  }
}

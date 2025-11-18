variable "otlp_endpoint" {
  sensitive = true
  type      = string
}

locals {
  # https://docs.aws.amazon.com/powertools/python/latest/#lambda-layer
  # https://github.com/open-telemetry/opentelemetry-lambda/blob/main/python/src/otel/otel_sdk/requirements.txt
  lambda_rt   = "python3.13"
  lambda_arch = "arm64"
  lambda_layers = [
    "arn:aws:lambda:${local.lambda_region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-${replace(local.lambda_rt, ".", "")}-${local.lambda_arch}:23",
    "arn:aws:lambda:${local.lambda_region}:184161586896:layer:opentelemetry-python-0_17_0:1"
  ]
  lambda_envs = {
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otlp_endpoint
  }
}

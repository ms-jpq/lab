locals {
  # https://docs.aws.amazon.com/powertools/python/latest/#lambda-layer
  lambda_rt    = "python3.13"
  lambda_arch  = "arm64"
  lambda_layer = "arn:aws:lambda:${local.lambda_region}:017000801446:layer:AWSLambdaPowertoolsPythonV3-${replace(local.lambda_rt, ".", "")}-${local.lambda_arch}:23"
}

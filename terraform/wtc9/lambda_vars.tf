locals {
  lambda_region = local.aws_regions.ca_w1
  lambda_functions = {
    okta    = { policies = [] }
    ppv     = { policies = [] }
    skyhook = { policies = [data.aws_iam_policy_document.skyhook] }
  }
}

data "archive_file" "haskell" {
  output_path = "${path.module}/../../var/faas.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

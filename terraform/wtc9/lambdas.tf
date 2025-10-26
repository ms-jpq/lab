locals {
  lambda_region = local.aws_regions.ca_w1
  lambda_functions = {
    okta    = { policy = data.aws_iam_policy_document.ppv }
    ppv     = { policy = data.aws_iam_policy_document.ppv }
    skyhook = { policy = data.aws_iam_policy_document.skyhook }
  }
}

data "archive_file" "haskell" {
  output_path = "${path.module}/../../var/skyhook.zip"
  source_dir  = "${path.module}/lambdas"
  type        = "zip"
}

resource "aws_iam_role" "lambdas" {
  for_each           = local.lambda_functions
  provider           = aws.ca_w1
  assume_role_policy = data.aws_iam_policy_document.allow_lambda.json
}

resource "aws_iam_policy" "lambdas" {
  for_each = local.lambda_functions
  provider = aws.ca_w1
  policy   = each.value.policy.json
}

resource "aws_iam_role_policy_attachment" "lambdas" {
  for_each   = local.lambda_functions
  provider   = aws.ca_w1
  role       = aws_iam_role.lambdas[each.key].name
  policy_arn = aws_iam_policy.lambdas[each.key].arn
}

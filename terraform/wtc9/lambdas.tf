data "aws_iam_policy_document" "allow_cloudwatch" {
  for_each = local.lambda_functions
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["${aws_cloudwatch_log_group.lambdas[each.key].arn}:*"]
  }
}

locals {
  lambda_role_policies = merge([
    for name, fn in local.lambda_functions :
    {
      for idx, policy in concat([data.aws_iam_policy_document.allow_cloudwatch[name]], fn.policies) :
      "${name}_${idx}" => { name = name, json = policy.json }
    }
  ]...)
}

output "lambda_role_policies" {
  value = local.lambda_role_policies
}

resource "aws_iam_role" "lambdas" {
  for_each           = local.lambda_functions
  provider           = aws.ca_w1
  assume_role_policy = data.aws_iam_policy_document.allow_lambda.json
}

resource "aws_iam_policy" "lambdas" {
  for_each = local.lambda_role_policies
  provider = aws.ca_w1
  policy   = each.value.json
}

resource "aws_iam_role_policy_attachment" "lambdas" {
  for_each   = local.lambda_role_policies
  provider   = aws.ca_w1
  role       = aws_iam_role.lambdas[each.value.name].name
  policy_arn = aws_iam_policy.lambdas[each.key].arn
}

resource "aws_cloudwatch_log_group" "lambdas" {
  for_each          = local.lambda_functions
  name              = "/aws/lambda/${each.key}"
  region            = local.lambda_region
  retention_in_days = 1
}

output "lambda_logging" {
  value = { for name, log in aws_cloudwatch_log_group.lambdas : name => "aws --region ${log.region} logs tail ${log.name} --follow" }
}

resource "aws_sns_topic" "siphon" {
  region = aws_dynamodb_table.mango.region
}

resource "aws_sns_topic_subscription" "siphon" {
  endpoint  = var.email_alert
  protocol  = "email"
  region    = aws_sns_topic.siphon.region
  topic_arn = aws_sns_topic.siphon.arn
}

data "aws_iam_policy_document" "siphon" {
  statement {
    actions   = ["sns:Publish"]
    effect    = "Allow"
    resources = [aws_sns_topic.siphon.arn]
  }
}

resource "aws_lambda_function_event_invoke_config" "siphon" {
  for_each = toset([
    for key, val in local.lambda_functions : key
    if contains(val.policies, data.aws_iam_policy_document.siphon)
  ])
  function_name          = each.value
  maximum_retry_attempts = 0
  region                 = aws_sns_topic.siphon.region

  destination_config {
    on_failure {
      destination = aws_sns_topic.siphon.arn
    }
  }
}

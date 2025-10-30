data "aws_iam_policy_document" "gateway_allowed" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["apigateway.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "gateway_sqs_integration" {
  statement {
    actions = [
      "sqs:GetQueueUrl",
      "sqs:SendMessage",
    ]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
}

resource "aws_iam_role" "api_gateway_sqs" {
  assume_role_policy = data.aws_iam_policy_document.gateway_allowed.json
}

resource "aws_iam_role_policy" "api_gateway_sqs" {
  policy   = data.aws_iam_policy_document.gateway_sqs_integration.json
  role     = aws_iam_role.api_gateway_sqs.id
}

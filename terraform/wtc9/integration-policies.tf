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
  provider           = aws.ca_w1
  assume_role_policy = data.aws_iam_policy_document.gateway_allowed.json
}

resource "aws_iam_role_policy" "api_gateway_sqs" {
  provider = aws.ca_w1
  policy   = data.aws_iam_policy_document.gateway_sqs_integration.json
  role     = aws_iam_role.api_gateway_sqs.id
}

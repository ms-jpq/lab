data "aws_s3_bucket" "maildir" {
  bucket = "kfc-mailbox"
  region = local.lambda_region
}

data "aws_iam_policy_document" "maildir" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }

    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.sink.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [data.aws_s3_bucket.maildir.arn]
    }
  }
}

resource "aws_sqs_queue_policy" "maildir" {
  policy    = data.aws_iam_policy_document.maildir.json
  queue_url = aws_sqs_queue.sink.id
  region    = aws_sqs_queue.sink.region
}

resource "aws_s3_bucket_notification" "maildir" {
  bucket     = data.aws_s3_bucket.maildir.bucket
  region     = aws_sqs_queue_policy.maildir.region

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.sink.arn
  }
}

variable "email_alert" {
  sensitive = true
  type      = string
}

variable "mail_user" {
  sensitive = true
  type      = string
}

variable "mail_pass" {
  sensitive = true
  type      = string
}

variable "mail_filter" {
  sensitive = true
  type      = string
}

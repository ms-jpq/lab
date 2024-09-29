data "aws_iam_policy_document" "maildir" {
  statement {
    actions   = ["s3:PutObject"]
    resources = [aws_s3_bucket.maildir.arn, "${aws_s3_bucket.maildir.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["ses.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "mbox" {
  statement {
    actions   = ["s3:PutObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    effect    = "Allow"
    resources = [aws_sqs_queue.mbox.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.maildir.arn]
    }
  }
}

data "aws_iam_policy_document" "dns" {
  statement {
    actions   = ["sqs:SendMessage"]
    effect    = "Allow"
    resources = [aws_sqs_queue.dns.arn]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_lambda_function.mta.arn]
    }
  }
}

data "aws_iam_policy_document" "mta" {
  statement {
    actions = ["sts:AssumeRole"]
    effect  = "Allow"

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "port_auth" {
  statement {
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["arn:aws:logs:::"]
  }
  statement {
    actions   = ["sqs:SendMessage"]
    effect    = "Allow"
    resources = [aws_sqs_queue.dns.arn]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.mbox.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:PutObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
  statement {
    actions   = ["ses:SendRawEmail"]
    effect    = "Allow"
    resources = ["*"]
  }
}

resource "aws_s3_bucket_policy" "maildir" {
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id
  policy   = data.aws_iam_policy_document.maildir.json
}

resource "aws_sqs_queue_policy" "qq" {
  provider = aws.us_e1
  for_each = {
    mbox = [aws_sqs_queue.mbox.id, data.aws_iam_policy_document.mbox],
    dns  = [aws_sqs_queue.dns.id, data.aws_iam_policy_document.dns],
  }
  queue_url = each.value[0]
  policy    = each.value[1].json
}

resource "aws_iam_role" "mta" {
  provider           = aws.us_e1
  assume_role_policy = data.aws_iam_policy_document.mta.json
}

resource "aws_iam_policy" "port_auth" {
  provider = aws.us_e1
  policy   = data.aws_iam_policy_document.port_auth.json
}

resource "aws_iam_role_policy_attachment" "port_auth" {
  provider   = aws.us_e1
  role       = aws_iam_role.mta.name
  policy_arn = aws_iam_policy.port_auth.arn
}

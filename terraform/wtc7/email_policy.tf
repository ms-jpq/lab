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
    actions   = ["sns:Publish"]
    effect    = "Allow"
    resources = [aws_sns_topic.sink.arn]
  }
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["${aws_cloudwatch_log_group.mta.arn}:*"]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
  statement {
    actions   = ["ses:SendEmail"]
    effect    = "Allow"
    resources = ["*"]
  }
}

resource "aws_s3_bucket_policy" "maildir" {
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id
  policy   = data.aws_iam_policy_document.maildir.json
}

resource "aws_iam_role" "mta" {
  provider           = aws.us_e1
  assume_role_policy = data.aws_iam_policy_document.mta.json
}

resource "aws_lambda_permission" "mta" {
  provider      = aws.us_e1
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mta.arn
  principal     = "s3.amazonaws.com"
  source_arn    = aws_s3_bucket.maildir.arn
  statement_id  = "AllowExecutionFromS3Bucket"
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

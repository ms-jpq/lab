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

data "aws_iam_policy_document" "port_auth" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    effect    = "Allow"
    resources = ["${aws_cloudwatch_log_group.mta.arn}:*"]
  }
  statement {
    actions   = ["sns:Publish"]
    effect    = "Allow"
    resources = [aws_sns_topic.sink.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.maildir.arn}/*"]
  }
}

resource "aws_s3_bucket_policy" "maildir" {
  bucket = aws_s3_bucket.maildir.id
  policy = data.aws_iam_policy_document.maildir.json
  region = aws_s3_bucket.maildir.region
}

resource "aws_iam_role" "mta" {
  assume_role_policy = data.aws_iam_policy_document.allow_lambda.json
}

resource "aws_lambda_permission" "mta" {
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.mta.arn
  principal     = "s3.amazonaws.com"
  region        = aws_lambda_function.mta.region
  source_arn    = aws_s3_bucket.maildir.arn
}

resource "aws_iam_policy" "port_auth" {
  policy = data.aws_iam_policy_document.port_auth.json
}

resource "aws_iam_role_policy_attachment" "port_auth" {
  role       = aws_iam_role.mta.name
  policy_arn = aws_iam_policy.port_auth.arn
}

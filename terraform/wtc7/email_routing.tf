resource "aws_ses_receipt_rule_set" "maildir" {
  region        = local.aws_regions.ca_c1
  rule_set_name = "maildir"
}

resource "aws_ses_active_receipt_rule_set" "maildir" {
  region        = aws_ses_receipt_rule_set.maildir.region
  rule_set_name = aws_ses_receipt_rule_set.maildir.rule_set_name
}

resource "aws_ses_receipt_rule" "maildir" {
  enabled       = true
  name          = "maildir"
  region        = aws_ses_receipt_rule_set.maildir.region
  rule_set_name = aws_ses_receipt_rule_set.maildir.rule_set_name

  s3_action {
    bucket_name = aws_s3_bucket.maildir.id
    position    = 1
  }
}

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

resource "aws_s3_bucket_policy" "maildir" {
  bucket = aws_s3_bucket.maildir.id
  policy = data.aws_iam_policy_document.maildir.json
  region = aws_s3_bucket.maildir.region
}

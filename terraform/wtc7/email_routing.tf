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

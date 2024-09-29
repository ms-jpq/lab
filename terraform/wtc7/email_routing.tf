resource "aws_ses_receipt_rule_set" "maildir" {
  provider      = aws.us_e1
  rule_set_name = "maildir"
}

resource "aws_ses_receipt_rule" "maildir" {
  provider      = aws.us_e1
  depends_on    = [aws_sqs_queue_policy.qq]
  name          = "maildir"
  rule_set_name = aws_ses_receipt_rule_set.maildir.rule_set_name

  add_header_action {
    header_name  = "X-Mail-To"
    header_value = urlencode(var.mail_to)
    position     = 1
  }
  s3_action {
    bucket_name = aws_s3_bucket.maildir.id
    position    = 2
  }
}

resource "aws_s3_bucket_notification" "maildir" {
  provider   = aws.us_e1
  depends_on = [aws_s3_bucket_policy.maildir, aws_sqs_queue_policy.qq]
  bucket     = aws_s3_bucket.maildir.id

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.mbox.arn
  }
}

resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sns_topic" "sink" {
  provider = aws.us_e1
}

resource "aws_s3_bucket_notification" "maildir" {
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id

  lambda_function {
    events              = ["s3:ObjectCreated:*"]
    lambda_function_arn = aws_lambda_permission.mta.function_name
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "maildir" {
  provider = aws.us_e1
  bucket   = aws_s3_bucket.maildir.id

  rule {
    id     = "diediedie"
    status = "Enabled"
    expiration {
      days = local.timeouts.s3_days
    }
  }
}

resource "aws_sns_topic_subscription" "sink" {
  provider  = aws.us_e1
  endpoint  = local.mail_alert
  protocol  = "email"
  topic_arn = aws_sns_topic.sink.arn
}

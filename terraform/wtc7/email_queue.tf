resource "aws_s3_bucket" "maildir" {
  region = local.aws_regions.us_e1
  bucket = "kfc-maildir"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sns_topic" "sink" {
  region = aws_s3_bucket.maildir.region
}

resource "aws_s3_bucket_notification" "maildir" {
  bucket = aws_s3_bucket.maildir.id
  region = aws_s3_bucket.maildir.region

  lambda_function {
    events              = ["s3:ObjectCreated:*"]
    lambda_function_arn = aws_lambda_permission.mta.function_name
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "maildir" {
  bucket = aws_s3_bucket.maildir.id
  region = aws_s3_bucket.maildir.region

  rule {
    id     = "diediedie"
    status = "Enabled"
    filter {}
    expiration {
      days = local.timeouts.s3_days
    }
  }
}

resource "aws_sns_topic_subscription" "sink" {
  endpoint  = local.mail_alert
  protocol  = "email"
  region    = aws_sns_topic.sink.region
  topic_arn = aws_sns_topic.sink.arn
}

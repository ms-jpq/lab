resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sqs_queue" "mbox" {
  provider                  = aws.us_e1
  message_retention_seconds = local.timeouts.mbox
}

resource "aws_sqs_queue" "sink" {
  provider                  = aws.us_e1
  message_retention_seconds = local.timeouts.sink
}

resource "aws_sns_topic" "sink" {
  provider = aws.us_e1
}

resource "aws_s3_bucket_notification" "maildir" {
  provider   = aws.us_e1
  depends_on = [aws_sqs_queue_policy.mbox]
  bucket     = aws_s3_bucket.maildir.id

  queue {
    events    = ["s3:ObjectCreated:*"]
    queue_arn = aws_sqs_queue.mbox.arn
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

resource "aws_sqs_queue_redrive_allow_policy" "sink" {
  provider  = aws.us_e1
  queue_url = aws_sqs_queue.sink.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.mbox.arn]
  })
}

resource "aws_sqs_queue_redrive_policy" "mbox" {
  provider  = aws.us_e1
  queue_url = aws_sqs_queue.mbox.id

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.sink.arn
    maxReceiveCount     = local.retries.mbox
  })
}

resource "aws_sns_topic_subscription" "sink" {
  provider  = aws.us_e1
  endpoint  = var.mail_to
  protocol  = "email"
  topic_arn = aws_sns_topic.sink.arn
}

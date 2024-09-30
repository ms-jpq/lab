resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
  lifecycle {
    prevent_destroy = true
  }
}

locals {
  timeouts = {
    s3_days = 2,
    queue   = 60,
    lambda  = 30
  }
}

resource "aws_sqs_queue" "mbox" {
  provider                   = aws.us_e1
  visibility_timeout_seconds = local.timeouts.queue
}

resource "aws_sqs_queue" "sink" {
  provider                   = aws.us_e1
  visibility_timeout_seconds = local.timeouts.queue
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
    maxReceiveCount     = 2
  })
}

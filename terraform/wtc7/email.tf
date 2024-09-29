resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sqs_queue" "mbox" {
  provider = aws.us_e1
}

resource "aws_sqs_queue" "sink" {
  provider = aws.us_e1
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
    maxReceiveCount     = 4
  })
}

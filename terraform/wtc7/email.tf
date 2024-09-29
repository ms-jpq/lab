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

resource "aws_sqs_queue" "dns" {
  provider = aws.us_e1
}

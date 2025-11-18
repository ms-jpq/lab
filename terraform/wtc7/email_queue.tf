resource "aws_s3_bucket" "maildir" {
  region = local.aws_regions.ca_c1
  bucket = "kfc-mailbox"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "maildir" {
  bucket = aws_s3_bucket.maildir.id
  region = aws_s3_bucket.maildir.region

  rule {
    id     = "diedie"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload {
      days_after_initiation = 4
    }
  }

  rule {
    id     = "diediedie"
    status = "Enabled"
    filter {}
    expiration {
      days = local.timeouts.s3_days
    }
  }
}

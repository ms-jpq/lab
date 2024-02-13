locals {
  s3_buckets = ["home", "lab"]
}

resource "aws_s3_bucket" "chum_bucket" {
  for_each = toset(local.s3_buckets)
  bucket   = "chumbucket-${each.key}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "chum_bucket" {
  for_each = aws_s3_bucket.chum_bucket
  bucket   = each.value.bucket
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

output "plankton" {
  value = [
    for bucket in aws_s3_bucket.chum_bucket :
    bucket.id
  ]
}

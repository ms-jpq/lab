locals {
  s3_buckets = ["home", "lab"]
}

resource "aws_s3_bucket" "kfc" {
  for_each      = toset(local.s3_buckets)
  bucket        = "kfc-${each.key}"
  force_destroy = true
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kfc" {
  for_each = aws_s3_bucket.kfc
  bucket   = each.value.bucket
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

output "kfc" {
  value = {
    buckets = [
      for bucket in aws_s3_bucket.kfc :
      bucket.id
    ]
  }
}

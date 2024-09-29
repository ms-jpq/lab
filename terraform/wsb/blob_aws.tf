locals {
  bastion_buckets = ["kfc-tfstate"]
  s2_users        = ["i6", "dev", "work"]
}

resource "aws_s3_bucket" "kfc" {
  for_each      = toset(local.s3_buckets)
  bucket        = each.key
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

output "aws_s3" {
  value = {
    buckets = [
      for bucket in aws_s3_bucket.kfc :
      bucket.id
    ]
    s2_accounts = {
      for key, access_key in aws_iam_access_key.s2 :
      key => access_key.id
    }
  }
}

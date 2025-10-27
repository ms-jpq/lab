locals {
  bastion_buckets = ["kfc-tfstate"]
}

resource "aws_s3_bucket" "kfc" {
  for_each      = toset(local.s3_buckets)
  bucket        = each.key
  force_destroy = true
  region        = local.aws_regions.ca_w1
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "kfc" {
  for_each = aws_s3_bucket.kfc
  bucket   = each.value.bucket
  region   = each.value.region
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
  }
}

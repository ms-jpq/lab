locals {
  bastion_buckets = ["kfc-tfstate"]
  s2_users        = ["i6", "dev", "work"]
}

resource "aws_iam_user" "s2" {
  for_each = toset(local.s2_users)
  name     = "s2-${each.key}"
}

data "aws_iam_policy_document" "s2" {
  statement {
    actions   = ["s3:*"]
    effect    = "Allow"
    resources = ["arn:aws:s3:::*"]
  }
  statement {
    actions = ["*"]
    effect  = "Deny"
    resources = flatten([
      for bucket in local.bastion_buckets : [
        "arn:aws:s3:::${bucket}",
        "arn:aws:s3:::${bucket}/*"
    ]])
  }
}

resource "aws_iam_policy" "s2" {
  policy = data.aws_iam_policy_document.s2.json
}

resource "aws_iam_access_key" "s2" {
  for_each = toset([for _, user in aws_iam_user.s2 : user.name])
  user     = each.key
}

resource "local_sensitive_file" "s2" {
  for_each = aws_iam_access_key.s2
  content  = each.value.secret
  filename = "${path.module}/../../facts/s2.${each.key}.env.key"
}

resource "aws_s3_bucket" "kfc" {
  for_each      = toset(local.buckets)
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

output "aws_s3" {
  value = {
    buckets = [
      for bucket in aws_s3_bucket.kfc :
      bucket.id
    ]
    accounts = {
      for key, access_key in aws_iam_access_key.s2 :
      key => access_key.id
    }
  }
}

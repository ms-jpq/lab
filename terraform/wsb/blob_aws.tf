locals {
  bastion_buckets = ["kfc-tfstate"]
  s2_users        = ["i6", "dev", "work"]
}

resource "aws_iam_user" "s2" {
  for_each = toset(local.s2_users)
  name     = "s2-${each.key}"
}


resource "aws_iam_policy" "s2" {
  policy = data.aws_iam_policy_document.s2.json
}

resource "aws_iam_user_policy_attachment" "sudo" {
  for_each   = { for _, user in aws_iam_user.s2 : user.name => aws_iam_policy.s2.arn }
  user       = each.key
  policy_arn = each.value
}

resource "aws_iam_access_key" "s2" {
  for_each = toset([for _, user in aws_iam_user.s2 : user.name])
  user     = each.key
}

resource "local_sensitive_file" "s2" {
  for_each = aws_iam_access_key.s2
  filename = "${path.module}/../../facts/s2.${each.key}.env.ini"
  content  = <<-INI
  [${each.key}]
  aws_access_key_id = ${each.value.id}
  aws_secret_access_key = ${each.value.secret}
  INI
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

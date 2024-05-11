provider "aws" {
}

data "aws_caller_identity" "whoami" {
}

resource "aws_iam_user" "sudo" {
  name = "sudo"
}

resource "aws_iam_user" "s2" {
  name = "s2"
}

data "aws_iam_policy" "sudo" {
  name = "AdministratorAccess"
}

locals {
  bastion_buckets = [aws_s3_bucket.tfstate.bucket, "kfc-i6"]
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

resource "aws_iam_user_policy_attachment" "sudo" {
  for_each = {
    (aws_iam_user.sudo.name) = data.aws_iam_policy.sudo.arn
    (aws_iam_user.s2.name)   = aws_iam_policy.s2.arn
  }
  user       = each.key
  policy_arn = each.value
}

resource "aws_iam_access_key" "pgp" {
  for_each = toset([aws_iam_user.sudo.name, aws_iam_user.s2.name])
  user     = each.key
}

resource "local_sensitive_file" "sponge" {
  for_each = aws_iam_access_key.pgp
  content  = each.value.secret
  filename = "${path.module}/../../facts/aws.${each.key}.env.key"
}

output "aws" {
  value = {
    iam = {
      root = data.aws_caller_identity.whoami.arn
      sudo = aws_iam_user.sudo.arn
      s2   = aws_iam_user.s2.arn
    }
    keys = {
      for key, access_key in aws_iam_access_key.pgp :
      key => access_key.id
    }
  }
}

provider "aws" {
}

data "aws_caller_identity" "whoami" {
}

resource "aws_iam_user" "sudo" {
  name = "sudo"
}

resource "aws_iam_user" "s3" {
  name = "s3"
}

resource "aws_iam_access_key" "pgp" {
  for_each = toset([aws_iam_user.sudo.name, aws_iam_user.s3.name])
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
      s3   = aws_iam_user.s3.arn
    }
  }
}

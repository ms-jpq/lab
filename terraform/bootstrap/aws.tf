provider "aws" {
}

data "aws_caller_identity" "whoami" {
}

resource "aws_iam_user" "sudo" {
  name = "sudo"
}

data "aws_iam_policy" "sudo" {
  name = "AdministratorAccess"
}

resource "aws_iam_user_policy_attachment" "sudo" {
  for_each = {
    (aws_iam_user.sudo.name) = data.aws_iam_policy.sudo.arn
  }
  user       = each.key
  policy_arn = each.value
}

resource "aws_iam_access_key" "pgp" {
  for_each = toset([aws_iam_user.sudo.name])
  user     = each.key
}

resource "local_sensitive_file" "sponge" {
  for_each = aws_iam_access_key.pgp
  filename = "${path.module}/../../facts/aws.${each.key}.env.ini"
  content  = <<-INI
  [${each.key}]
  aws_access_key_id = ${each.value.id}
  aws_secret_access_key = ${each.value.secret}
  INI
}

output "aws" {
  value = {
    iam = {
      whoami = data.aws_caller_identity.whoami.arn
      sudo   = aws_iam_user.sudo.arn
    }
    keys = {
      for key, access_key in aws_iam_access_key.pgp :
      key => access_key.id
    }
  }
}

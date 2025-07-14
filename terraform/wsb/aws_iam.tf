locals {
  s2_users   = ["i6", "dev", "work"]
  smtp_users = ["t2"]
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
      for bucket in concat(local.s3_buckets, local.bastion_buckets) : [
        "arn:aws:s3:::${bucket}",
        "arn:aws:s3:::${bucket}/*"
    ]])
  }
}

data "aws_iam_policy_document" "smtp" {
  statement {
    actions   = ["ses:SendRawEmail"]
    effect    = "Allow"
    resources = ["*"]
  }
}

locals {
  iam_policies = {
    s2      = { doc = data.aws_iam_policy_document.s2, users = local.s2_users }
    smtp    = { doc = data.aws_iam_policy_document.smtp, users = local.smtp_users }
    s2-debs = { doc = data.aws_iam_policy_document.s3_debs, users = local.s3_deb_users }
  }
}

resource "aws_iam_policy" "iam" {
  for_each = local.iam_policies
  policy   = each.value.doc.json
}

locals {
  iam_users = concat([
    for key, val in local.iam_policies :
    [for user in val.users : "${key}-${user}"]
  ]...)
}

resource "aws_iam_user" "iam" {
  for_each = toset(local.iam_users)
  name     = each.key
}

resource "aws_iam_user_policy_attachment" "iam" {
  for_each = merge([
    for key, pol in aws_iam_policy.iam :
    {
      for user in local.iam_policies[key].users :
      aws_iam_user.iam["${key}-${user}"].name => pol.arn
    }
  ]...)
  user       = each.key
  policy_arn = each.value
}

resource "aws_iam_access_key" "iam" {
  provider   = aws.us_e1
  for_each   = toset(local.iam_users)
  depends_on = [aws_iam_user.iam]
  user       = each.key
}

resource "local_sensitive_file" "s2" {
  for_each = merge(
    {
      for user in local.s2_users :
      user => aws_iam_access_key.iam["s2-${user}"]
    },
    {
      for user in local.s3_deb_users :
      user => aws_iam_access_key.iam["s2-debs-${user}"]
    }
  )
  filename = "${path.module}/../../facts/s2.${each.key}.env.ini"
  content  = <<-INI
  [${each.key}]
  aws_access_key_id = ${each.value.id}
  aws_secret_access_key = ${each.value.secret}
  INI
}

resource "local_sensitive_file" "smtp" {
  for_each = {
    for user in local.smtp_users :
    user => aws_iam_access_key.iam["smtp-${user}"]
  }
  filename = "${path.module}/../../facts/smtp.${each.key}.env.netrc"
  content  = <<-NETRC
  machine ${local.mail_srv}
    login ${each.value.id}
    password ${each.value.ses_smtp_password_v4}
  NETRC
}

output "aws_iam" {
  value = {
    for key, access_key in aws_iam_access_key.iam :
    key => access_key.id
  }
}

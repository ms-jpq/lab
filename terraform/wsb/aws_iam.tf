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
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    effect    = "Allow"
    resources = [""]
  }
}

resource "aws_iam_policy" "s2" {
  policy = data.aws_iam_policy_document.s2.json
}

resource "aws_iam_user" "s2" {
  for_each = toset(local.s2_users)
  name     = "s2-${each.key}"
}

resource "aws_iam_user_policy_attachment" "s2" {
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

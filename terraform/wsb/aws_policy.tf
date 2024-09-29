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

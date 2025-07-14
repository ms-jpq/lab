variable "s3_debs" {
  type = string
}

locals {
  s3_debs      = var.s3_debs
  s3_deb_users = ["github-ci"]
}

data "aws_iam_policy_document" "s3_debs" {
  statement {
    actions = ["s3:*"]
    effect  = "Allow"
    resources = [
      "arn:aws:s3:::${local.s3_debs}",
      "arn:aws:s3:::${local.s3_debs}/*"
    ]
  }
}

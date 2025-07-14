variable "s3_debs" {
  type = string
}

locals {
  s3_debs      = aws_s3_bucket.kfc[var.s3_debs]
  s3_deb_users = ["github-ci"]
}

data "aws_iam_policy_document" "s3_debs" {
  statement {
    actions = ["s3:*"]
    effect  = "Allow"
    resources = [
      "arn:aws:s3:::${local.s3_debs.bucket}",
      "arn:aws:s3:::${local.s3_debs.bucket}/*"
    ]
  }
}

data "aws_iam_policy_document" "science_world" {
  statement {
    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions   = ["s3:GetObject"]
    effect    = "Allow"
    resources = ["arn:aws:s3:::${local.s3_debs.bucket}/*"]
  }
}

resource "aws_s3_bucket_policy" "s3_debs" {
  bucket = local.s3_debs.bucket
  policy = data.aws_iam_policy_document.science_world.json
}

output "aws_debs" {
  value = <<-SOURCE
  deb [signed-by=/etc/apt/trusted.gpg.d/ms-jpq.gpg] ${local.s3_debs.bucket_domain_name} /
  SOURCE
}

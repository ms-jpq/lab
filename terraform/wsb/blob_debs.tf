variable "deb_bucket" {
  type = string
}

locals {
  s3_deb_users = ["github-ci"]
}

resource "aws_s3_bucket" "deb_bucket" {
  bucket        = var.deb_bucket
  region        = local.aws_regions.ca_w1
  force_destroy = true
  lifecycle {
    prevent_destroy = true
  }
}

data "aws_iam_policy_document" "deb_bucket" {
  statement {
    actions = ["s3:*"]
    effect  = "Allow"
    resources = [
      "arn:aws:s3:::${aws_s3_bucket.deb_bucket.bucket}",
      "arn:aws:s3:::${aws_s3_bucket.deb_bucket.bucket}/*"
    ]
  }
}

resource "aws_s3_bucket_website_configuration" "science_world" {
  bucket = aws_s3_bucket.deb_bucket.bucket
  region = aws_s3_bucket.deb_bucket.region
  index_document {
    suffix = "Packages"
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
    resources = ["arn:aws:s3:::${aws_s3_bucket.deb_bucket.bucket}/*"]
  }
}

resource "aws_s3_bucket_public_access_block" "science_world" {
  block_public_policy = false
  bucket              = aws_s3_bucket.deb_bucket.bucket
  region              = aws_s3_bucket.deb_bucket.region
}

resource "aws_s3_bucket_policy" "science_world" {
  bucket = aws_s3_bucket_public_access_block.science_world.bucket
  policy = data.aws_iam_policy_document.science_world.json
}

output "aws_debs" {
  value = <<-SOURCE
  deb [signed-by=/etc/apt/trusted.gpg.d/ms-jpq.gpg] https://${aws_s3_bucket_website_configuration.science_world.website_endpoint} /
  SOURCE
}

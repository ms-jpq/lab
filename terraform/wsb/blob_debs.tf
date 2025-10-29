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

resource "aws_cloudfront_cache_policy" "science_world" {
  name = "naive-debs"
  parameters_in_cache_key_and_forwarded_to_origin {
    query_strings_config {
      query_string_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    cookies_config {
      cookie_behavior = "none"
    }
  }
}

locals {
  aws_deb_origin_id = aws_s3_bucket.deb_bucket.id
}

resource "aws_cloudfront_origin_access_control" "science_world" {
  name                              = "science-world-tickets"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "science_world" {
  enabled         = true
  is_ipv6_enabled = true

  origin {
    domain_name              = aws_s3_bucket.deb_bucket.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.science_world.id
    origin_id                = local.aws_deb_origin_id
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cache_policy_id        = aws_cloudfront_cache_policy.science_world.id
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = local.aws_deb_origin_id
    viewer_protocol_policy = "allow-all"
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

data "aws_iam_policy_document" "science_world" {
  statement {
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.deb_bucket.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.science_world.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "science_world" {
  bucket = aws_s3_bucket.deb_bucket.bucket
  policy = data.aws_iam_policy_document.science_world.json
}

output "aws_debs" {
  value = <<-SOURCE
  deb [signed-by=/etc/apt/trusted.gpg.d/ms-jpq.gpg] http://${aws_cloudfront_distribution.science_world.domain_name} /
  SOURCE
}

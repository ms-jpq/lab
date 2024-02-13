locals {
  tf_modules = [
    for mod in [
      for deps in fileset("${path.module}/..", "*/deps.tf") :
      basename(dirname(deps))
    ] :
    mod if mod != basename(abspath(path.module))
  ]
}

output "tf_modules" {
  value = local.tf_modules
}

resource "aws_dynamodb_table" "tfstate" {
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  name         = "tfstate"

  attribute {
    name = "LockID"
    type = "S"
  }
}

resource "aws_s3_bucket" "tfstate" {
  bucket        = "kfc-${aws_dynamodb_table.tfstate.id}"
  force_destroy = true
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.bucket
  rule {
    bucket_key_enabled = true
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.bucket
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.bucket
  rule {
    id     = "death-and-decay"
    status = "Enabled"
    noncurrent_version_expiration {
      newer_noncurrent_versions = 3
      noncurrent_days           = 9
    }
  }
}

output "tfstate" {
  value = {
    bucket = aws_s3_bucket.tfstate.id
    table  = aws_dynamodb_table.tfstate.id
  }
}

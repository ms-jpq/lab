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

resource "aws_s3_bucket" "tfs" {
  for_each = toset(local.tf_modules)
  bucket   = "tfstate-${each.key}"
}

resource "aws_s3_bucket_versioning" "tfs_version" {
  for_each = aws_s3_bucket.tfs
  bucket   = each.value.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_dynamodb_table" "tfs_lock" {
  for_each     = aws_s3_bucket.tfs
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"
  name         = each.value.bucket

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "tfs_s3_bucket" {
  value = [
    for bucket in aws_s3_bucket.tfs :
    {
      bucket = bucket.id
    }
  ]
}

output "tfs_dynamodb_table" {
  value = [
    for table in aws_dynamodb_table.tfs_lock :
    {
      table = table.id
    }
  ]
}

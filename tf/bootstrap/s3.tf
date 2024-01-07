resource "aws_s3_bucket" "tfs" {
  bucket = "tfstate"
}

resource "aws_s3_bucket_versioning" "tfs_v" {
  bucket = aws_s3_bucket.tfs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_dynamodb_table" "tfs_lock" {
  hash_key       = "LockID"
  name           = aws_s3_bucket.tfs.bucket
  read_capacity  = 1
  write_capacity = 1

  attribute {
    name = "LockID"
    type = "S"
  }
}

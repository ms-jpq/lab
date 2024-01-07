output "tfs_s3_bucket" {
  value = {
    bucket = aws_s3_bucket.tfs.id
    region = aws_s3_bucket.tfs.region
  }
}

output "tfs_dynamodb_table" {
  value = {
    table = aws_dynamodb_table.tfs_lock.id
  }
}

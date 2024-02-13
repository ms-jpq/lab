locals {
  symmetric_keys = ["ebs"]
}

resource "aws_kms_key" "symmetric" {
  for_each     = toset(local.symmetric_keys)
  multi_region = true
}

resource "aws_kms_alias" "symmetric" {
  for_each      = aws_kms_key.symmetric
  name          = "alias/symmetric/${each.key}"
  target_key_id = each.value.id
}

output "keys" {
  value = {
    symmetric = [
      for _, val in aws_kms_alias.symmetric :
      val.name
    ]
  }
}

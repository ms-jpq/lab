resource "aws_kms_key" "iscsi" {
  for_each     = toset(keys(local.ebs_vols))
  multi_region = true
}

resource "aws_kms_alias" "iscsi" {
  for_each      = aws_kms_key.iscsi
  name          = "alias/iscsi/${each.key}"
  target_key_id = each.value.id
}

locals {
  kms_aliases = {
    for _, val in aws_kms_alias.iscsi :
    val.target_key_arn => val.id
  }
}

resource "aws_ebs_volume" "iscsi" {
  for_each          = aws_kms_key.iscsi
  availability_zone = local.aws_zones.ca_w1[0]
  encrypted         = true
  kms_key_id        = each.value.arn
  size              = each.value.size
  type              = "gp3"
  tags = {
    id = "iscsi-${each.key}"
  }
  lifecycle {
    prevent_destroy = true
  }
}

output "ebs" {
  value = [
    for vol in aws_ebs_volume.iscsi :
    {
      disk = "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${replace(vol.id, "-", "")}"
      id   = vol.id
      kms  = local.kms_aliases[vol.kms_key_id]
      size = vol.size
      tag  = vol.tags.id
      type = vol.type
      zone = vol.availability_zone
    }
  ]
}

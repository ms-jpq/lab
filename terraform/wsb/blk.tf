locals {
  ebs_vols = {
  }
  light_vols = {
    btrfs = {
      size = 8
      type = "gp3"
    }
  }
  vultr_vols = {
    btrfs = {
      size = 120
    }
  }
}

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
  type              = each.value.type
  tags = {
    id = "iscsi-${each.key}"
  }
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_disk" "iscsi" {
  provider          = aws.us_w2
  for_each          = local.light_vols
  availability_zone = local.aws_zones.us_w2[0]
  name              = "iscsi-${each.key}"
  size_in_gb        = each.value.size
  lifecycle {
    prevent_destroy = true
  }
}

data "external" "ebs_lite" {
  program = ["${path.module}/lightsail_ebs.sh"]
  query = {
    region = local.aws_regions.us_w2
    disks = jsonencode([
      for vol in aws_lightsail_disk.iscsi :
      vol.id
    ])
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

output "ebs_lite" {
  value = [
    for key, val in {
      for name, json in data.external.ebs_lite.result :
      name => jsondecode(json)
    } :
    {
      id   = key
      iops = val.iops
      size = val.sizeInGb
      zone = val.location.availabilityZone
    }
  ]
}

resource "vultr_block_storage" "iscsi" {
  for_each   = local.vultr_vols
  block_type = "storage_opt"
  label      = "iscsi-${each.key}"
  live       = true
  region     = local.vultr_regions.seattle
  size_gb    = each.value.size
  lifecycle {
    prevent_destroy = true
  }
}

output "vblk" {
  value = [
    for key, val in vultr_block_storage.iscsi : {
      id   = val.id
      size = val.size_gb
      zone = val.region
    }
  ]
}

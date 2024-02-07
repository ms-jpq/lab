locals {
  s3_buckets = ["home", "lab"]
  ebs_vols   = {}
  light_vols = {
    droplet = {
      size = 8
    }
    btrfs = {
      size = 8
    }
  }
}

resource "aws_s3_bucket" "chum_bucket" {
  for_each = toset(local.s3_buckets)
  bucket   = "chumbucket-${each.key}"
  lifecycle {
    prevent_destroy = true
  }
}

output "plankton" {
  value = [
    for bucket in aws_s3_bucket.chum_bucket :
    {
      name = bucket.id
    }
  ]
}

resource "aws_ebs_volume" "iscsi" {
  for_each          = local.ebs_vols
  availability_zone = local.zones.ca_w1[0]
  size              = each.value.size
  type              = "gp3"
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
  availability_zone = local.zones.us_w2[0]
  name              = "iscsi-${each.key}"
  size_in_gb        = each.value.size
  lifecycle {
    prevent_destroy = true
  }
}

data "external" "ls_ebs" {
  program = ["${path.module}/lightsail_ebs.sh"]
  query = {
    region = local.regions.us_w2
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
      size = vol.size
      type = vol.type
      zone = vol.availability_zone
    }
  ]
}

output "ls_ebs" {
  value = [
    for key, val in {
      for name, json in data.external.ls_ebs.result :
      name => jsondecode(json)
    } :
    {
      id    = key
      iops  = val.iops
      size  = val.sizeInGb
      state = val.state
      zone  = val.location.availabilityZone
    }
  ]
}

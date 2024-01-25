locals {
  s3_buckets = ["lab"]
  ebs_vols = {
    droplet = {
      size = 9
    }
  }
}

resource "aws_s3_bucket" "chum" {
  for_each = toset(local.s3_buckets)
  bucket   = "chum-${each.key}"
}

output "plankton" {
  value = [
    for bucket in aws_s3_bucket.chum :
    {
      bucket = bucket.id
    }
  ]
}

resource "aws_ebs_volume" "nfs" {
  for_each          = local.ebs_vols
  availability_zone = "${data.aws_region.current.name}a"
  size              = each.value.size
  type              = "gp3"
  tags = {
    id = "nfs-${each.key}"
  }
  lifecycle {
    prevent_destroy = true
  }
}

output "smb" {
  value = [
    for vol in aws_ebs_volume.nfs :
    {
      id   = vol.id
      size = vol.size
      type = vol.type
      zone = vol.availability_zone
    }
  ]
}

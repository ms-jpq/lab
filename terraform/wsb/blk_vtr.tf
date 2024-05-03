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

output "vultr_blk" {
  value = [
    for key, val in vultr_block_storage.iscsi : {
      id   = val.id
      size = val.size_gb
      zone = val.region
    }
  ]
}

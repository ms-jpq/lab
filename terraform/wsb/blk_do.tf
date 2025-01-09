resource "digitalocean_volume" "iscsi" {
  for_each                = local.do_vols
  initial_filesystem_type = "xfs"
  name                    = "iscsi-${each.key}"
  region                  = local.do_regions.tor[0]
  size                    = each.value.size
  lifecycle {
    prevent_destroy = true
  }
}

output "do_volume" {
  value = [
    for key, val in digitalocean_volume.iscsi :
    {
      id     = val.id
      region = val.region
      size   = val.size
    }
  ]
}

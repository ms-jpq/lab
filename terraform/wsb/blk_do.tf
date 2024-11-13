resource "digitalocean_volume" "iscsi" {
  for_each = local.do_vols
  region   = local.do_regions.nyc[0]
  name     = "iscsi-${each.key}"
  size     = each.value.size
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

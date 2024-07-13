data "digitalocean_regions" "abbottabad" {
  filter {
    key    = "available"
    values = ["true"]
  }
  filter {
    key      = "slug"
    match_by = "re"
    values   = ["^nyc"]
  }
}

locals {
  do_regions = [
    for region in data.digitalocean_regions.abbottabad.regions :
    region.slug
  ]
}

data "digitalocean_regions" "nyc" {
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
  do_regions = {
    nyc = sort([
      for region in data.digitalocean_regions.nyc.regions :
      region.slug
    ])
  }
}

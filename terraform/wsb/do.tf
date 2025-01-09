data "digitalocean_regions" "oceans" {
  for_each = toset(["tor", "nyc"])
  filter {
    key    = "available"
    values = ["true"]
  }
  filter {
    key      = "slug"
    match_by = "re"
    values   = ["^${each.key}"]
  }
}

locals {
  do_regions = {
    for key, val in data.digitalocean_regions.oceans :
    key => [for region in val.regions : region.slug]
  }
}

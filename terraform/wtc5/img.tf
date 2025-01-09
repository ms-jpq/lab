data "digitalocean_images" "ubuntu_lts" {
  filter {
    key    = "status"
    values = ["available"]
  }
  filter {
    all    = true
    key    = "regions"
    values = local.do_regions.tor
  }
  filter {
    key    = "type"
    values = ["base"]
  }
  filter {
    key    = "distribution"
    values = ["Ubuntu"]
  }
  filter {
    key      = "name"
    match_by = "re"
    values   = ["24\\.04"]
  }
  sort {
    key       = "created"
    direction = "desc"
  }
}

locals {
  do_image = one([
    for img in data.digitalocean_images.ubuntu_lts.images :
    img
  ])
}

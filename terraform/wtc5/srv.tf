data "digitalocean_sizes" "super" {
  filter {
    key    = "available"
    values = ["true"]
  }
  filter {
    key    = "regions"
    values = local.do_regions
  }
  sort {
    direction = "desc"
    key       = "memory"
  }
  sort {
    direction = "asc"
    key       = "price_monthly"
  }
}

locals {
  do_sizes = [
    for size in data.digitalocean_sizes.super.sizes :
    size if size.memory >= 4096
  ]
  do_size   = local.do_sizes[0]
  do_region = local.do_size.regions[0]
}

resource "digitalocean_droplet" "droplet" {
  droplet_agent = false
  image         = local.do_image.id
  ipv6          = true
  name          = "droplet"
  region        = local.do_region
  size          = local.do_size.slug
  ssh_keys      = local.ssh_keys
}

locals {
  ip_addrs = {
    v4 = [digitalocean_droplet.droplet.ipv4_address]
    v6 = [digitalocean_droplet.droplet.ipv6_address]
  }
}

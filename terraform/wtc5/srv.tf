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
    direction = "asc"
    key       = "price_monthly"
  }
  sort {
    direction = "desc"
    key       = "memory"
  }
}

locals {
  do_sizes = [
    for size in data.digitalocean_sizes.super.sizes :
    size if size.memory >= 4096
  ]
  do_size = local.do_sizes[0]
  do_region = sort([
    for region in local.do_size.regions :
    region if contains(local.do_regions, region)
  ])[0]
}

output "supersize" {
  value = {
    disk     = "${local.do_size.disk}GB"
    memory   = "${local.do_size.memory}MB"
    price    = "${local.do_size.price_monthly}USD"
    transfer = "${local.do_size.transfer}TB"
    vcpus    = local.do_size.vcpus
  }
}

resource "digitalocean_ssh_key" "kms" {
  for_each   = toset(local.ssh_keys)
  name       = sha256(each.value)
  public_key = each.value
}

resource "digitalocean_droplet" "droplet" {
  droplet_agent = false
  image         = local.do_image.id
  ipv6          = true
  name          = "droplet"
  region        = local.do_region
  size          = local.do_size.slug
  ssh_keys      = [for key in digitalocean_ssh_key.kms : key.id]
}

locals {
  ip_addrs = {
    v4 = [digitalocean_droplet.droplet.ipv4_address]
    v6 = [digitalocean_droplet.droplet.ipv6_address]
  }
}

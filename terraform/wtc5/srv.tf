data "digitalocean_sizes" "super" {
  filter {
    key    = "available"
    values = ["true"]
  }
  filter {
    key    = "regions"
    values = local.do_regions.tor
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

data "digitalocean_volume" "droplet" {
  name   = "iscsi-drop"
  region = local.do_regions.tor[0]
}

locals {
  do_sizes = [
    for size in data.digitalocean_sizes.super.sizes :
    size if size.memory >= 3000
  ]
  do_size = local.do_sizes[0]
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
  region        = data.digitalocean_volume.droplet.region
  size          = local.do_size.slug
  ssh_keys      = [for key in digitalocean_ssh_key.kms : key.id]
  lifecycle {
    prevent_destroy = true
  }
}

resource "digitalocean_volume_attachment" "droplet" {
  droplet_id = digitalocean_droplet.droplet.id
  volume_id  = data.digitalocean_volume.droplet.id
}

locals {
  ip_addrs = {
    v4 = [digitalocean_droplet.droplet.ipv4_address]
    v6 = [digitalocean_droplet.droplet.ipv6_address]
  }
}

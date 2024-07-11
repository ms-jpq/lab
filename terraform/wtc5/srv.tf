resource "digitalocean_droplet" "web" {
  image    = data.digitalocean_image.ubuntu_lts.id
  ipv6     = true
  name     = ""
  region   = "nyc2"
  size     = "s-1vcpu-1gb"
  ssh_keys = local.ssh_keys
}

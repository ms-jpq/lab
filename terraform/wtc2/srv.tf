resource "aws_lightsail_instance" "droplet" {
  provider          = aws.us_w2
  availability_zone = local.zones.us_w2[0]
  blueprint_id      = "ubuntu_22_04"
  bundle_id         = "small_3_0"
  name              = "droplet"
}

resource "aws_lightsail_disk_attachment" "john_cena" {
  provider      = aws.us_w2
  disk_name     = "iscsi-droplet"
  disk_path     = "/dev/xvdp"
  instance_name = aws_lightsail_instance.droplet.name
}

locals {
  ip_addrs = {
    v4 = [aws_lightsail_instance.droplet.public_ip_address]
    v6 = aws_lightsail_instance.droplet.ipv6_addresses
  }
}

output "lightsail-droplet" {
  value = {
    id   = aws_lightsail_instance.droplet.id
    zone = aws_lightsail_instance.droplet.availability_zone
  }
}

data "external" "user_data" {
  program = ["${path.module}/user-data.sh"]
  query = {
    hostname = "droplet"
    ssh_keys = jsonencode(local.ssh_keys)
  }
}

resource "aws_lightsail_instance" "droplet" {
  provider          = aws.us_w2
  availability_zone = local.zones.us_w2[0]
  blueprint_id      = "ubuntu_22_04" # aws lightsail --region us-west-2 get-blueprints | jq --raw-output '.blueprints[].blueprintId'
  bundle_id         = "small_3_0"    # aws lightsail --region us-west-2 get-bundles
  name              = data.external.user_data.query.hostname
  user_data         = data.external.user_data.result.script
}

locals {
  ip_addrs = {
    v4 = [aws_lightsail_instance.droplet.public_ip_address]
    v6 = aws_lightsail_instance.droplet.ipv6_addresses
  }
}

resource "aws_lightsail_disk_attachment" "john_cena" {
  provider      = aws.us_w2
  disk_name     = "iscsi-droplet"
  disk_path     = "/dev/xvdp"
  instance_name = aws_lightsail_instance.droplet.name
}

output "lightsail-droplet" {
  value = {
    id   = aws_lightsail_instance.droplet.id
    zone = aws_lightsail_instance.droplet.availability_zone
  }
}

locals {
  ls_name            = "droplet"
  cloud_init_scripts = "${path.module}/cloud-init"
  cloud_init_env = [
    "HOSTNAME=${base64encode(local.ls_name)}",
    "SSH_KEYS=${base64encode(join("\n", local.ssh_keys))}"
  ]
  cloud_init_b64 = base64encode(join("\n", concat(local.cloud_init_env, [
    for file in fileset(local.cloud_init_scripts, "*.sh") :
    file("${local.cloud_init_scripts}/${file}")
  ])))
  user_data = "printf -- %s ${local.cloud_init_b64} | base64 --decode | bash"
}

resource "aws_lightsail_instance" "droplet" {
  provider          = aws.us_w2
  availability_zone = local.aws_zones.us_w2[0]
  blueprint_id      = "ubuntu_22_04" # aws lightsail --region us-west-2 get-blueprints | jq --raw-output '.blueprints[].blueprintId'
  bundle_id         = "small_3_0"    # aws lightsail --region us-west-2 get-bundles
  name              = local.ls_name
  user_data         = local.user_data
  lifecycle {
    # https://github.com/hashicorp/terraform-provider-aws/issues/5011
    ignore_changes = [user_data]
  }
}

locals {
  ip_addrs = {
    v4 = [aws_lightsail_instance.droplet.public_ip_address]
    v6 = aws_lightsail_instance.droplet.ipv6_addresses
  }
}

resource "aws_lightsail_instance_public_ports" "acab" {
  provider      = aws.us_w2
  instance_name = aws_lightsail_instance.droplet.name
  port_info {
    from_port = 0
    protocol  = "all"
    to_port   = 65535
  }
  lifecycle {
    ignore_changes = [port_info]
  }
}

resource "aws_lightsail_disk_attachment" "john_cena" {
  provider      = aws.us_w2
  for_each      = { "iscsi-btrfs" = "/dev/xvdp" }
  disk_name     = each.key
  disk_path     = each.value
  instance_name = aws_lightsail_instance.droplet.name
}

output "lightsail-droplet" {
  value = {
    id   = aws_lightsail_instance.droplet.id
    zone = aws_lightsail_instance.droplet.availability_zone
  }
}

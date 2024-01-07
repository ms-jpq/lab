output "ubuntu-lts-ami" {
  value = {
    "id"   = data.aws_ami.ubuntu-lts.id
    "name" = data.aws_ami.ubuntu-lts.name
  }
}

output "droplet-props" {
  value = {
    "id"     = aws_instance.droplet.id
    "ip"     = concat([aws_instance.droplet.public_ip], aws_instance.droplet.ipv6_addresses)
    "vol_id" = aws_ebs_volume.family.id
  }
}

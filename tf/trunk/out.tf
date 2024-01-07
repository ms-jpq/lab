output "ami-ubuntu-lts" {
  value = {
    id   = data.aws_ami.ubuntu-lts.id
    name = data.aws_ami.ubuntu-lts.name
  }
}

output "c-init" {
  value = {
    id        = aws_launch_template.u-jammy.id
    # user_data = base64decode(data.cloudinit_config.user_data.rendered)
  }
}

output "ec2-droplet" {
  value = {
    id     = aws_instance.droplet.id
    ip     = concat([aws_instance.droplet.public_ip], aws_instance.droplet.ipv6_addresses)
    vol_id = aws_ebs_volume.family.id
  }
}

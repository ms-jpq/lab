resource "aws_instance" "droplet" {
  instance_type = "t4g.small"
  launch_template {
    id = aws_launch_template.familia.id
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = 50
  }
  lifecycle {
    # https://github.com/hashicorp/terraform-provider-aws/issues/5011
    ignore_changes = [user_data]
  }
}

data "aws_ebs_volume" "john" {
  filter {
    name   = "tag:id"
    values = ["nfs-droplet"]
  }
  most_recent = true
}

resource "aws_volume_attachment" "cena" {
  device_name  = "/dev/sdf"
  instance_id  = aws_instance.droplet.id
  skip_destroy = true
  volume_id    = data.aws_ebs_volume.john.id
}

output "ec2-droplet" {
  value = {
    id = aws_instance.droplet.id
    ip = concat([aws_instance.droplet.public_ip], aws_instance.droplet.ipv6_addresses)
  }
}

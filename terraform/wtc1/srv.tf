data "aws_ebs_volume" "john" {
  filter {
    name   = "tag:id"
    values = ["iscsi-droplet"]
  }
  most_recent = true
}

resource "aws_instance" "droplet" {
  availability_zone = aws_subnet.onlyfams.availability_zone
  instance_type     = "t3.small"
  launch_template {
    id = aws_launch_template.familia.id
  }
  root_block_device {
    volume_type = aws_launch_template.familia.block_device_mappings[0].ebs[0].volume_type
  }
  lifecycle {
    # https://github.com/hashicorp/terraform-provider-aws/issues/5011
    ignore_changes = [user_data]
  }
}

locals {
  ip_addrs = {
    v4 = [aws_instance.droplet.public_ip]
    v6 = aws_instance.droplet.ipv6_addresses
  }
}

resource "aws_volume_attachment" "cena" {
  device_name  = "/dev/sdp"
  instance_id  = aws_instance.droplet.id
  skip_destroy = true
  volume_id    = data.aws_ebs_volume.john.id
}

output "ec2-droplet" {
  value = {
    id = aws_instance.droplet.id
  }
}

resource "aws_launch_template" "u-jammy" {
  image_id  = "ami-0a24e6e101933d294" # Ubuntu 22.04 arm64
  name      = "u-jammy"
  user_data = base64encode(local.user_data)

  network_interfaces {
    security_groups = [aws_security_group.acab.id]
    subnet_id       = aws_subnet.onlyfams.id
  }
}

resource "aws_ebs_volume" "family" {
  availability_zone = aws_subnet.onlyfams.availability_zone
  size              = 50
  type              = "gp3"
}

resource "aws_instance" "droplet" {
  instance_type = "t4g.small"
  launch_template {
    id = aws_launch_template.u-jammy.id
  }
  root_block_device {
    volume_type = "gp3"
    volume_size = 50
  }
}

resource "aws_volume_attachment" "the_rocky" {
  device_name = "/dev/sdf"
  instance_id = aws_instance.droplet.id
  volume_id   = aws_ebs_volume.family.id
}
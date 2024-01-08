resource "aws_launch_template" "u-jammy" {
  lifecycle {
    ignore_changes       = [user_data]
    replace_triggered_by = [terraform_data.user_data]
  }
  image_id  = data.aws_ami.ubuntu-lts.id
  name      = "u-jammy"
  user_data = data.cloudinit_config.ci_data.rendered

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

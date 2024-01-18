
output "ebs-john" {
  value = {
    id   = aws_ebs_volume.john.id
    size = aws_ebs_volume.john.size
    type = aws_ebs_volume.john.type
  }
}

output "ec2-droplet" {
  value = {
    id     = aws_instance.droplet.id
    ip     = concat([aws_instance.droplet.public_ip], aws_instance.droplet.ipv6_addresses)
    vol_id = aws_ebs_volume.john.id
  }
}

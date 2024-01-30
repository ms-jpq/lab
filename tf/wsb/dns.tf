resource "aws_route53_zone" "sea_to_sky" {
  name = var.le_domain
}

output "sea_to_sky_name_servers" {
  value = aws_route53_zone.sea_to_sky.name_servers
}

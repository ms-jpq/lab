# locals {
#   sea_to_sky_domain = var.le_domain
# }

# resource "aws_lightsail_domain_entry" "sea_to_sky_mx" {
#   provider    = aws.us_e1
#   domain_name = local.sea_to_sky_domain
#   name        = ""
#   target      = "1 ${local.sea_to_sky_domain}"
#   type        = "MX"
# }

# TODO: bugged: terraform cannot find lightsail DNS records named: "*"
# resource "aws_lightsail_domain_entry" "sea_to_sky_c" {
#   provider    = aws.us_e1
#   domain_name = local.sea_to_sky_domain
#   name        = "*"
#   target      = local.sea_to_sky_domain
#   type        = "CNAME"
# }

# resource "aws_lightsail_domain_entry" "sea_to_sky_a" {
#   provider    = aws.us_e1
#   domain_name = local.sea_to_sky_domain
#   name        = ""
#   target      = aws_lightsail_instance.droplet.public_ip_address
#   type        = "A"
# }

# resource "aws_lightsail_domain_entry" "sea_to_sky_a4" {
#   provider    = aws.us_e1
#   for_each    = toset(aws_lightsail_instance.droplet.ipv6_addresses)
#   domain_name = local.sea_to_sky_domain
#   name        = ""
#   target      = each.key
#   type        = "AAAA"
# }

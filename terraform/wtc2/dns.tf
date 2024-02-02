resource "aws_lightsail_domain_entry" "sea_to_sky_mx" {
  provider    = aws.us_e1
  domain_name = var.le_domain
  name        = ""
  target      = "1 ${var.le_domain}"
  type        = "MX"
}

# TODO: bugged: terraform cannot find lightsail DNS records named: "*"
# resource "aws_lightsail_domain_entry" "sea_to_sky_c" {
#   provider    = aws.us_e1
#   domain_name = var.le_domain
#   name        = "*"
#   target      = var.le_domain
#   type        = "CNAME"
# }

resource "aws_lightsail_domain_entry" "sea_to_sky_a" {
  provider    = aws.us_e1
  domain_name = var.le_domain
  name        = ""
  target      = aws_lightsail_instance.droplet.public_ip_address
  type        = "A"
}

resource "aws_lightsail_domain_entry" "sea_to_sky_a4" {
  provider    = aws.us_e1
  domain_name = var.le_domain
  name        = ""
  target      = join("\n", aws_lightsail_instance.droplet.ipv6_addresses)
  type        = "AAAA"
}

output "dns" {
  value = {
    a  = split("\n", aws_lightsail_domain_entry.sea_to_sky_a.target)
    a4 = split("\n", aws_lightsail_domain_entry.sea_to_sky_a4.target)
    mx = split("\n", aws_lightsail_domain_entry.sea_to_sky_mx.target)
  }
}

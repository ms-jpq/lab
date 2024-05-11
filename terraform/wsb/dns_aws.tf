resource "aws_route53_zone" "sea_to_sky" {
  for_each = toset([])
  name     = each.key
}

output "route53_name_servers" {
  value = {
    for srv in aws_route53_zone.sea_to_sky :
    srv.name => srv.name_servers
  }
}

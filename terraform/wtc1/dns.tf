data "aws_route53_zone" "sea_to_sky" {
  name = var.le_domain
}

resource "aws_route53_record" "sea_to_sky_mx" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = ["1 ${data.aws_route53_zone.sea_to_sky.name}"]
  ttl     = local.dns_ttl
  type    = "MX"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_c" {
  name    = "*.${data.aws_route53_zone.sea_to_sky.name}"
  records = [data.aws_route53_zone.sea_to_sky.name]
  ttl     = local.dns_ttl
  type    = "CNAME"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = local.ip_addrs.v4
  ttl     = local.dns_ttl
  type    = "A"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

resource "aws_route53_record" "sea_to_sky_a4" {
  name    = data.aws_route53_zone.sea_to_sky.name
  records = local.ip_addrs.v6
  ttl     = local.dns_ttl
  type    = "AAAA"
  zone_id = data.aws_route53_zone.sea_to_sky.zone_id
}

# resource "aws_route53_zone" "squamish" {
#   for_each = local.dns_ptrs
#   name     = each.key
# }
#
# resource "aws_route53_record" "sea_to_sky_ptr" {
#   for_each = merge([
#     for zone, addrs in local.dns_ptrs :
#     { for addr in addrs : addr => zone }
#   ]...)
#   name    = "${each.key}."
#   records = [data.aws_route53_zone.sea_to_sky.name]
#   ttl     = local.dns_ttl
#   type    = "PTR"
#   zone_id = aws_route53_zone.squamish[each.value].zone_id
# }

output "dns_aws" {
  value = {
    a   = aws_route53_record.sea_to_sky_a.records
    a4  = aws_route53_record.sea_to_sky_a4.records
    c   = aws_route53_record.sea_to_sky_c.records
    mx  = aws_route53_record.sea_to_sky_mx.records
    # ptr = toset([for srv in aws_route53_record.sea_to_sky_ptr : srv.name])
  }
}

data "aws_availability_zones" "cf" {
  for_each = local.aws_regions
  region   = each.value
  state    = "available"
}

locals {
  aws_zones = { for key, val in data.aws_availability_zones.cf : key => val.names }
}

output "aws_zones" {
  value = local.aws_zones
}

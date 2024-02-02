data "aws_availability_zones" "ca_w1" {
  provider = aws
  state    = "available"
}

data "aws_availability_zones" "us_e1" {
  provider = aws.us_e1
  state    = "available"
}

data "aws_availability_zones" "us_w2" {
  provider = aws.us_w2
  state    = "available"
}

locals {
  zones = {
    ca_w1 = data.aws_availability_zones.ca_w1.names
    us_e1 = data.aws_availability_zones.us_e1.names
    us_w2 = data.aws_availability_zones.us_w2.names
  }
}

output "zones" {
  value = local.zones
}

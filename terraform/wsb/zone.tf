data "aws_availability_zones" "district_69" {
  state = "available"
}

output "zones" {
  value = data.aws_availability_zones.district_69.names
}

variable "le_domain" {
  type = string
}

locals {
  dns_ttl = 60
}

output "dns_ttl" {
  value = local.dns_ttl
}

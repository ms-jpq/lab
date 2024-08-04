variable "le_domain" {
  type = string
}

locals {
  dns_ttl = 60
  dns_ptrs = {
    for record in concat(
      [for record in local.ip_addrs.v4 : provider::functions::ip_address(record).reverse_pointer],
      [for record in local.ip_addrs.v6 : provider::functions::ip_address(record).reverse_pointer]
    ) :
    record => one(regex("^[[:alnum:]]+\\.(.+)$", record))
  }
}

output "dns_ttl" {
  value = local.dns_ttl
}

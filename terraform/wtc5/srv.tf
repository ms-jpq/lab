variable "vps_ipv4" {
  type = string
}

variable "vps_ipv6" {
  type = string
}


locals {
  ip_addrs = {
    v4 = [var.vps_ipv4]
    v6 = [var.vps_ipv6]
  }
}

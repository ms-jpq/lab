variable "mail_from" {
  type = string
}

variable "mail_to" {
  type = list(string)
}

locals {
  dns_ttl = 60
}


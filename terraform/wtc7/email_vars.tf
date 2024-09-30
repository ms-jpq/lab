variable "mail_from" {
  type = string
}

variable "mail_to" {
  type = string
}

locals {
  dns_ttl = 60
  timeouts = {
    s3_days = 2,
    queue   = 9,
    lambda  = 6
  }
}

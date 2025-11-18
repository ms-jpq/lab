variable "mail_to" {
  type = list(string)
}

variable "email_alert" {
  sensitive = true
  type      = string
}

locals {
  dns_ttl = 60
  timeouts = {
    s3_days = 1,
    lambda  = 6
  }
}


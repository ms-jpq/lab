variable "mail_from" {
  type = string
}

variable "mail_to" {
  type = string
}

variable "mail_user" {
  sensitive = true
  type      = string
}

variable "mail_pass" {
  sensitive = true
  type      = string
}

locals {
  dns_ttl = 60
  timeouts = {
    s3_days  = 1,
    lambda   = 6
    mbox     = 60
    sink     = 360
    batching = 300
  }
  retries = {
    mbox = 2
  }
}

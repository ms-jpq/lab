variable "mail_from" {
  type = string
}

variable "mail_to" {
  type = list(string)
}

variable "mail_user" {
  sensitive = true
  type      = string
}

variable "mail_pass" {
  sensitive = true
  type      = string
}

variable "mail_filter" {
  sensitive = true
  type      = string
}

locals {
  dns_ttl    = 60
  mail_alert = var.mail_to[0]
  timeouts = {
    s3_days = 1,
    lambda  = 6
  }
  retries = {
    lambda = 2
  }
}

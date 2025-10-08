variable "auth0_domain" {
  type = string
}

variable "auth0_lobechat_domain" {
  type = string
}

provider "auth0" {
  domain = var.auth0_domain
}

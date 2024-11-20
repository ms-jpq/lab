variable "auth0_domain" {
  type = string
}

provider "auth0" {
  domain = var.auth0_domain
}

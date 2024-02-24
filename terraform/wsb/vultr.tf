provider "vultr" {
}

data "vultr_account" "whoami" {
}

locals {
  vultr_account = data.vultr_account.whoami
}

output "vultr" {
  value = {
    email = local.vultr_account.email
  }
}

provider "vultr" {
}

data "vultr_account" "whoami" {
}

data "vultr_region" "seattle" {
  filter {
    name   = "city"
    values = ["Seattle"]
  }
}

locals {
  vultr_account = data.vultr_account.whoami
  vultr_regions = {
    seattle = data.vultr_region.seattle.id
  }
}

output "vultr" {
  value = {
    account_id = local.vultr_account.email,
    regions    = local.vultr_regions
  }
}

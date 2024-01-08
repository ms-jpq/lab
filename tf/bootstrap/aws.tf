variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region
  # TODO: next release should fix this
  skip_region_validation = true
}

data "aws_caller_identity" "current" {}

locals {
  aws_account_id = data.aws_caller_identity.current.account_id
}

output "aws_account_id" {
  value = local.aws_account_id
}

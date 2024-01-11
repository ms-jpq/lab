variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region
  # TODO: next release should fix this
  skip_region_validation = true
}

data "aws_caller_identity" "current" {}
# data "aws_region" "current" {}

locals {
  aws_account_id = data.aws_caller_identity.current.account_id
  # aws_region     = data.aws_region.current.name
}

output "aws" {
  value = {
    account_id = local.aws_account_id,
    # region     = local.aws_region
  }
}

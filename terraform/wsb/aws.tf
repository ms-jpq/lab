locals {
  aws_profile     = "sudo"
  aws_credentials = "${path.module}/../../facts/aws.${local.aws_profile}.env.ini"
}

provider "aws" {
  region                   = "ca-west-1"
  profile                  = local.aws_profile
  shared_credentials_files = [local.aws_credentials]
}

data "aws_caller_identity" "whoami" {
}

data "aws_region" "ca_w1" {
  region = "ca-west-1"
}
data "aws_region" "ca_c1" {
  region = "ca-central-1"
}

locals {
  aws_account = data.aws_caller_identity.whoami
  aws_regions = {
    ca_w1 = data.aws_region.ca_w1.region
    ca_c1 = data.aws_region.ca_c1.region
  }
}

output "aws" {
  value = {
    account_id = local.aws_account.account_id,
    regions    = local.aws_regions
  }
}

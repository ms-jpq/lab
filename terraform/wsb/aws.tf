locals {
  aws_profile     = "sudo"
  aws_credentials = "${path.module}/../../facts/aws.${local.aws_profile}.env.ini"
}

provider "aws" {
  alias                    = "ca_w1"
  region                   = "ca-west-1"
  profile                  = local.aws_profile
  shared_credentials_files = [local.aws_credentials]
}
provider "aws" {
  alias                    = "us_e1"
  region                   = "us-east-1"
  profile                  = local.aws_profile
  shared_credentials_files = [local.aws_credentials]
}
provider "aws" {
  alias                    = "us_w2"
  region                   = "us-west-2"
  profile                  = local.aws_profile
  shared_credentials_files = [local.aws_credentials]
}

data "aws_caller_identity" "whoami" {
}

data "aws_region" "ca_w1" {
  provider = aws.ca_w1
}
data "aws_region" "us_e1" {
  provider = aws.us_e1
}
data "aws_region" "us_w2" {
  provider = aws.us_w2
}

locals {
  aws_account = data.aws_caller_identity.whoami
  aws_regions = {
    ca_w1 = data.aws_region.ca_w1.name
    us_e1 = data.aws_region.us_e1.name
    us_w2 = data.aws_region.us_w2.name
  }
}

output "aws" {
  value = {
    account_id = local.aws_account.account_id,
    regions    = local.aws_regions
  }
}

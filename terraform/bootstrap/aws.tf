provider "aws" {
  region = "ca-west-1"
}

provider "aws" {
  alias  = "us_e1"
  region = "us-east-1"
}

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_region" "us_e1" {
  provider = aws.us_e1
}

locals {
  aws_account_id = data.aws_caller_identity.current.account_id
  current_region = data.aws_region.current.name
  us_e1_region   = data.aws_region.us_e1.name
}

output "aws" {
  value = {
    account_id     = local.aws_account_id,
    current_region = local.current_region
    us_e1_region   = local.us_e1_region
  }
}

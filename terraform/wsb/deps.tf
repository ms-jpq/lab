terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 0"
    }
    external = {
      source  = "hashicorp/external"
      version = ">= 0"
    }
  }
}

terraform {
  backend "s3" {
    bucket         = "tfstate-wsb"
    dynamodb_table = "tfstate-wsb"
    encrypt        = true
    key            = "tfstate"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

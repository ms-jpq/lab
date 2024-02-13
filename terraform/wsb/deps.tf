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
    bucket         = "kfc-tfstate"
    dynamodb_table = "tfstate-wsb"
    encrypt        = true
    key            = "wsb.json"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

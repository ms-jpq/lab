terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 0"
    }
    cloudinit = {
      source  = "hashicorp/cloudinit"
      version = ">= 0"
    }
    http = {
      source  = "hashicorp/http"
      version = ">= 0"
    }
  }
}

terraform {
  backend "s3" {
    bucket         = "tfstate-wtc1"
    dynamodb_table = "tfstate-wtc1"
    encrypt        = true
    key            = "tfstate"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

terraform {
  required_version = ">= 0"
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = ">= 0"
    }
    cloudinit = {
      source  = "hashicorp/cloudinit"
      version = ">= 0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = ">= 0"
    }
  }
}

terraform {
  backend "s3" {
    encrypt        = true
    key            = "tfstate"
    bucket         = "tfstate-wtc"
    dynamodb_table = "tfstate-wtc"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

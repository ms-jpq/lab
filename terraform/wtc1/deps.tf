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
    bucket         = "kfc-tfstate"
    dynamodb_table = "tfstate-wtc1"
    encrypt        = true
    key            = "wtc1.json"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

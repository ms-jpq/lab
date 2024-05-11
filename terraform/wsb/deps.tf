terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 0"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 0"
    }
    local = {
      source  = "hashicorp/local"
      version = ">= 0"
    }
  }
}

terraform {
  backend "s3" {
    bucket         = "kfc-tfstate"
    dynamodb_table = "tfstate"
    encrypt        = true
    key            = "wsb.json"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

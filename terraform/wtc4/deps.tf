terraform {
  required_version = ">= 0"
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = ">= 0"
    }
    google = {
      source  = "hashicorp/google"
      version = ">= 0"
    }
  }
}

terraform {
  backend "s3" {
    bucket         = "kfc-tfstate"
    dynamodb_table = "tfstate"
    encrypt        = true
    key            = "wtc4.json"
    region         = "ca-west-1"
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

terraform {
  required_version = ">= 0"
  required_providers {
    http = {
      source  = "hashicorp/http"
      version = "~> 3"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7"
    }
  }
}

terraform {
  backend "s3" {
    bucket                   = "kfc-tfstate"
    dynamodb_table           = "tfstate"
    encrypt                  = true
    key                      = "wtc4.json"
    profile                  = "sudo"
    region                   = "ca-west-1"
    shared_credentials_files = ["../../facts/aws.sudo.env.ini"]
  }
}

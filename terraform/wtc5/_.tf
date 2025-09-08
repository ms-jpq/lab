terraform {
  required_version = ">= 0"
  required_providers {
    functions = {
      source  = "ms-jpq/functions"
      version = ">= 0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6"
    }
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2"
    }
  }
}

terraform {
  backend "s3" {
    bucket                   = "kfc-tfstate"
    dynamodb_table           = "tfstate"
    encrypt                  = true
    key                      = "wtc5.json"
    profile                  = "sudo"
    region                   = "ca-west-1"
    shared_credentials_files = ["../../facts/aws.sudo.env.ini"]
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

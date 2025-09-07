terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6"
    }
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2"
    }
  }
}

terraform {
  backend "s3" {
    bucket                   = "kfc-tfstate"
    dynamodb_table           = "tfstate"
    encrypt                  = true
    key                      = "wsb.json"
    profile                  = "sudo"
    region                   = "ca-west-1"
    shared_credentials_files = ["../../facts/aws.sudo.env.ini"]
    # TODO: next release should fix this
    skip_region_validation = true
  }
}

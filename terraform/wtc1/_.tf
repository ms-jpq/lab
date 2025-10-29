terraform {
  required_version = ">= 0"
  required_providers {
    functions = {
      source  = "ms-jpq/functions"
      version = ">= 0"
    }
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6"
    }
    cloudinit = {
      source  = "hashicorp/cloudinit"
      version = "~> 2"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3"
    }
  }
}

terraform {
  backend "s3" {
    bucket                   = "kfc-tfstate"
    encrypt                  = true
    key                      = "wtc1.json"
    profile                  = "sudo"
    region                   = "ca-west-1"
    shared_credentials_files = ["../../facts/aws.sudo.env.ini"]
    use_lockfile             = true
  }
}

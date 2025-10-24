terraform {
  required_version = ">= 0"
  required_providers {
    auth0 = {
      source  = "auth0/auth0"
      version = "~> 1"
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
    encrypt                  = true
    key                      = "wtc8.json"
    profile                  = "sudo"
    region                   = "ca-west-1"
    shared_credentials_files = ["../../facts/aws.sudo.env.ini"]
    use_lockfile             = true
  }
}

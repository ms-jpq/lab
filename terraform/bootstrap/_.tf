terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6"
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

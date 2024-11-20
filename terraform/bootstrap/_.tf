terraform {
  required_version = ">= 0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2"
    }
  }
}

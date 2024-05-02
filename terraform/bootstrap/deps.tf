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
  }
}

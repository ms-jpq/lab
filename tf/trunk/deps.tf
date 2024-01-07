terraform {
  required_providers {
    http = {
      source = "hashicorp/http"
    }
    aws = {
      source = "hashicorp/aws"
    }
  }
}

terraform {
  backend "s3" {
    bucket  = ""
    encrypt = true
    key     = "tfstate"
  }
}

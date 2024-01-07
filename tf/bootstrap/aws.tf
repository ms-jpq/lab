variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region
  # TODO: next release should fix this
  skip_region_validation = true
}

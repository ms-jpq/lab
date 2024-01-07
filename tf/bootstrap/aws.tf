variable "aws_region" {
  type = string
}

provider "aws" {
  region = var.aws_region
}

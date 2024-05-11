provider "aws" {
}

data "aws_caller_identity" "whoami" {
}

output "aws" {
  value = {
    whoami = data.aws_caller_identity.whoami
  }
}

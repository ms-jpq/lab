variable "github_user" {
  type = string
}

data "http" "gh_keys" {
  url = "https://github.com/${var.github_user}.keys"
}

locals {
  ssh_keys  = split("\n", trimspace(data.http.gh_keys.response_body))
  user_data = templatefile("${path.module}/user-data.yml", { ssh_keys = jsonencode(local.ssh_keys) })
}

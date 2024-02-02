variable "github_users" {
  type = list(string)
}

data "http" "gh_keys" {
  for_each = toset(var.github_users)
  url      = "https://github.com/${each.key}.keys"
}

locals {
  ssh_keys = sort(flatten([
    for resp in data.http.gh_keys :
    split("\n", trimspace(resp.response_body))
  ]))
}

output "ssh_keys" {
  value = local.ssh_keys
}

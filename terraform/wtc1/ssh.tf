variable "github_users" {
  type = set(string)
}

data "http" "gh_keys" {
  for_each = var.github_users
  url      = "https://github.com/${each.key}.keys"
}

locals {
  ssh_keys = sort(flatten([
    for resp in data.http.gh_keys :
    split("\n", trimspace(resp.response_body))
  ]))
}

output "ssh_sha" {
  value = sha256(join("\n", local.ssh_keys))
}

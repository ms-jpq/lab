resource "vultr_ssh_key" "keys" {
  for_each = toset(local.ssh_keys)
  name     = sha256(each.value)
  ssh_key  = each.value
}

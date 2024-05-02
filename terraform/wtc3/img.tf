# curl -- https://api.vultr.com/v2/os
data "vultr_os" "ubuntu_lts" {
  filter {
    name   = "name"
    values = ["Ubuntu 24.04 LTS x64"]
  }
}

output "os_ubuntu_lts" {
  value = {
    id   = data.vultr_os.ubuntu_lts.id
    name = data.vultr_os.ubuntu_lts.name
  }
}

# curl -- https://api.vultr.com/v2/plans
data "vultr_plan" "agenda" {
  filter {
    name   = "locations"
    values = [local.vultr_regions.seattle]
  }
  filter {
    name   = "type"
    values = ["vc2"]
  }
  filter {
    name   = "ram"
    values = [2048]
  }
  filter {
    name   = "vcpu_count"
    values = [2]
  }
}

output "vultr_plan" {
  value = {
    bandwidth = data.vultr_plan.agenda.bandwidth
    cost      = data.vultr_plan.agenda.monthly_cost
    disk      = data.vultr_plan.agenda.disk
    id        = data.vultr_plan.agenda.id
  }
}

resource "vultr_instance" "droplet" {
  os_id       = data.vultr_os.ubuntu_lts.id
  plan        = data.vultr_plan.agenda.id
  region      = local.vultr_regions.seattle
  ssh_key_ids = [for _, val in vultr_ssh_key.keys : val.id]
}

locals {
  ip_addrs = {
    v4 = [vultr_instance.droplet.main_ip]
    v6 = [vultr_instance.droplet.v6_main_ip]
  }
}

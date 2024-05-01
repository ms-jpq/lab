locals {
  ebs_vols = {
  }
  light_vols = {
  }
  compute_vols = {
    fuchsia = {
      size = 20
      type = "pd-standard"
    }
  }
  vultr_vols = {
    fuchsia = {
      size = 40
      type = "storage_opt"
    }
  }
}

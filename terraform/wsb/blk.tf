locals {
  ebs_vols     = {}
  compute_vols = {}
  do_vols = {
    drop = {
      size = 10
    }
  }
}

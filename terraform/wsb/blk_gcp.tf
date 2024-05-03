resource "google_compute_disk" "iscsi" {
  provider = google.kalimdor
  for_each = local.compute_vols
  name     = "iscsi-${each.key}"
  size     = each.value.size
  type     = "pd-standard"
  zone     = local.gcp_regions.kalimdor[0]
  lifecycle {
    prevent_destroy = true
  }
}

output "compute_disk" {
  value = [
    for key, val in google_compute_disk.iscsi :
    {
      id   = val.id
      size = val.size
      zone = val.zone
    }
  ]
}

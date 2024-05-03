provider "google" {
  alias       = "kalimdor"
  credentials = "${path.module}/../../facts/gcp.kalimdor.env.json"
  project     = "kalimdor-3"
  region      = "northamerica-northeast2"
}

data "google_project" "kalimdor" {
  provider = google.kalimdor
}

data "google_compute_zones" "kalimdor" {
  provider = google.kalimdor
}

locals {
  gcp_project = data.google_project.kalimdor.project_id
  gcp_regions = {
    kalimdor = data.google_compute_zones.kalimdor.names
  }
}

output "gcp" {
  value = {
    project = local.gcp_project
    regions = local.gcp_regions
  }
}

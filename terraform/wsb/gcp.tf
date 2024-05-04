provider "google" {
  alias       = "kalimdor"
  credentials = "${path.module}/../../facts/gcp.kalimdor.env.json"
  project     = "kalimdor-3"
  region      = "northamerica-northeast2"
}

provider "google" {
  alias       = "lordaeron"
  credentials = "${path.module}/../../facts/gcp.lordaeron.env.json"
  project     = "lordaeron-2"
  region      = "us-west1"
}

data "google_project" "kalimdor" {
  provider = google.kalimdor
}

data "google_compute_zones" "kalimdor" {
  provider = google.kalimdor
}

locals {
  gcp_projects = {
    kalimdor = data.google_project.kalimdor.project_id
  }
  gcp_regions = {
    kalimdor = data.google_compute_zones.kalimdor.names
  }
}

output "gcp" {
  value = {
    projects = local.gcp_projects
    regions  = local.gcp_regions
  }
}

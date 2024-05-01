provider "google" {
  alias       = "ca_e2"
  credentials = "${path.module}/../../facts/gcp.env.json"
  project     = "unit0-257718"
  region      = "northamerica-northeast2"
}

data "google_compute_zones" "ca_e2" {
  provider = google.ca_e2
}

locals {
  gcp_regions = {
    ca_e2 = data.google_compute_zones.ca_e2.names
  }
}

output "gcp" {
  value = {
    regions = local.gcp_regions
  }
}

provider "google" {
  alias       = "ca_e2"
  credentials = "${path.module}/../../facts/gcp.env.json"
  region      = "northamerica-northeast2"
}

data "google_service_account" "whoami" {
  provider   = google.ca_e2
  account_id = "arthas@new-lordaeron.iam.gserviceaccount.com"
}


data "google_service_account_iam_policy" "iam" {
  provider           = google.ca_e2
  service_account_id = data.google_service_account.whoami.name
}

data "google_project" "lordaeron" {
  provider   = google.ca_e2
  project_id = "new-lordaeron"
}

data "google_compute_zones" "ca_e2" {
  provider = google.ca_e2
  project  = local.gcp_project
}

locals {
  gcp_account = data.google_service_account.whoami.account_id
  gcp_project = data.google_project.lordaeron.project_id
  gcp_regions = {
    ca_e2 = data.google_compute_zones.ca_e2.names
  }
}

output "gcp" {
  value = {
    account_id = local.gcp_account
    iam        = data.google_service_account_iam_policy.iam.policy_data
    project    = local.gcp_project
    regions    = local.gcp_regions
  }
}

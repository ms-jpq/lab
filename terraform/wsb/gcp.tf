provider "google" {
  alias       = "dalaran"
  credentials = "${path.module}/../../facts/gcp.dalaran.env.json"
  project     = "dalaran-3"
}

provider "google" {
  alias       = "kalimdor"
  credentials = "${path.module}/../../facts/gcp.kalimdor.env.json"
  project     = "kalimdor-3"
}

resource "google_project_service" "kalimdor" {
  provider = google.kalimdor
  for_each = toset(["compute.googleapis.com"])
  service  = each.key
}

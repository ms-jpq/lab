provider "google" {
  alias       = "dalaran"
  credentials = "${path.module}/../../facts/gcp.dalaran.env.json"
  project     = "dalaran-3"
}

provider "google" {
  alias                 = "kalimdor"
  credentials           = "${path.module}/../../facts/gcp.kalimdor.env.json"
  project               = "kalimdor-3"
  billing_project       = "dalaran-3"
  user_project_override = true
}

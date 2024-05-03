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

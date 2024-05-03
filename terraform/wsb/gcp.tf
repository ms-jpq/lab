provider "google" {
  alias       = "kalimdor"
  credentials = "${path.module}/../../facts/gcp.kalimdor.env.json"
  project     = "kalimdor-3"
}

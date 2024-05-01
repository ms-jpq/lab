provider "google" {
  alias       = "ca_e2"
  credentials = "${path.module}/../../facts/gcp.env.json"
  project     = "unit0-257718"
  region      = "northamerica-northeast2"
}

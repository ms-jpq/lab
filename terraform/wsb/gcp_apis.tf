resource "google_project_service" "dalaran" {
  provider = google.dalaran
  for_each = toset(["billingbudgets.googleapis.com"])
  service  = each.key
}

resource "google_project_service" "kalimdor" {
  provider = google.kalimdor
  for_each = toset(["compute.googleapis.com"])
  service  = each.key
}

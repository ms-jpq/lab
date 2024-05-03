provider "google" {
  alias = "root"
}

locals {
  gcp_projects = {
    dalaran   = "dalaran-3",
    kalimdor  = "kalimdor-3",
    lordaeron = "lordaeron-2"
  }
}

resource "google_project" "wc3" {
  provider   = google.root
  for_each   = local.gcp_projects
  name       = each.key
  project_id = each.value
}

resource "google_service_account" "wc3" {
  for_each   = google_project.wc3
  account_id = each.key
  project    = each.value.project_id
}

data "google_iam_role" "kleptocrat" {
  name = "roles/owner"
}

resource "google_project_iam_member" "wc3" {
  for_each = google_service_account.wc3
  project  = each.value.project
  role     = data.google_iam_role.kleptocrat.name
  member   = "serviceAccount:${each.value.email}"
}

resource "google_service_account_key" "wc3" {
  for_each           = google_service_account.wc3
  service_account_id = each.value.id
}

output "gcp_projects" {
  value = { for _, acc in google_service_account.wc3 : acc.project => acc.email }
}

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
  account_id = "sudo-user"
  project    = each.value.project_id
}

data "google_iam_role" "kleptocrat" {
  for_each = toset(["roles/owner"])
  name     = each.key
}

resource "google_project_iam_member" "wc3" {
  for_each = merge([for k1, acc in google_service_account.wc3 : {
    for k2, role in data.google_iam_role.kleptocrat :
    "${k1}-${k2}" => {
      email   = acc.email
      project = acc.project
      role    = role.name
    }
  }]...)
  member  = "serviceAccount:${each.value.email}"
  project = each.value.project
  role    = each.value.role
}

resource "google_service_account_key" "wc3" {
  for_each           = google_service_account.wc3
  service_account_id = each.value.id
}

output "gcp_projects" {
  value = { for _, acc in google_service_account.wc3 :
    acc.project => {
      owner = acc.email
    }
  }
}

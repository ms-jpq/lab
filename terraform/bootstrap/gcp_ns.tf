provider "google" {
  alias = "root"
}

data "google_billing_account" "tinker" {
  display_name = "tinker"
}

locals {
  gcp_projects = {
    dalaran   = "dalaran-3",
    kalimdor  = "kalimdor-3",
    lordaeron = "lordaeron-2"
  }
}

resource "google_project" "wc3" {
  for_each        = local.gcp_projects
  billing_account = data.google_billing_account.tinker.id
  name            = each.key
  project_id      = each.value
}

resource "google_service_account" "cenarius" {
  for_each   = google_project.wc3
  account_id = "sudo-user"
  project    = each.value.project_id
}

data "google_iam_role" "oligarch" {
  for_each = toset(["roles/billing.admin"])
  name     = each.key
}

data "google_iam_role" "kleptocrat" {
  for_each = toset(["roles/owner"])
  name     = each.key
}

resource "google_billing_account_iam_member" "tinker" {
  for_each = merge([
    for k1, acc in google_service_account.cenarius : {
      for k2, role in data.google_iam_role.oligarch :
      "${k1}-${k2}" => {
        email   = acc.email
        project = k1
        role    = role.name
      }
  }]...)
  billing_account_id = google_project.wc3[each.value.project].billing_account
  member             = "serviceAccount:${each.value.email}"
  role               = each.value.role
}

resource "google_project_iam_member" "druid" {
  for_each = merge([
    for k1, acc in google_service_account.cenarius : {
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

resource "google_service_account_key" "fel" {
  for_each           = google_service_account.cenarius
  service_account_id = each.value.id
}

output "gcp" {
  value = {
    billing = {
      id = data.google_billing_account.tinker.id
    }
    projects = {
      for _, acc in google_service_account.cenarius :
      acc.project => {
        owner = acc.email
      }
    }
  }
}

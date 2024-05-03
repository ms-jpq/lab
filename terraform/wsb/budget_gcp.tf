# resource "google_monitoring_notification_channel" "wall_st" {
#   project      = local.gcp_project
#   display_name = "wall_st"
#   type         = "email"
#   labels = {
#     email_address = var.mein_email
#   }
# }

data "google_billing_account" "tinker" {
  provider        = google.dalaran
  billing_account = "012EEF-C61BAC-5A298A"
}

data "google_iam_role" "pmc" {
  name = "roles/serviceusage.serviceUsageConsumer"
}

data "google_service_account" "dalaran" {
  provider   = google.dalaran
  account_id = "sudo-user"
}

resource "google_project_iam_member" "kalimdor_pmc" {
  provider = google.kalimdor
  member   = "serviceAccount:${data.google_service_account.dalaran.email}"
  project  = "kalimdor-3"
  role     = data.google_iam_role.pmc.name
}

# resource "google_billing_budget" "septims" {
#   provider        = google.kalimdor
#   billing_account = data.google_billing_account.tinker.id
#   display_name    = "Example Billing Budget"
#   amount {
#     specified_amount {
#       currency_code = "USD"
#       units         = tostring(local.budget)
#     }
#   }
#   dynamic "threshold_rules" {
#     for_each = toset([
#       for i in range(0, 1) :
#       tostring(1 + i * 0.05)
#     ])
#     content {
#       threshold_percent = tonumber(threshold_rules.key)
#     }
#   }
# }

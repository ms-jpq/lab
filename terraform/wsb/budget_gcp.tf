# resource "google_monitoring_notification_channel" "wall_st" {
#   project      = local.gcp_project
#   display_name = "wall_st"
#   type         = "email"
#   labels = {
#     email_address = var.mein_email
#   }
# }

data "google_billing_account" "tinker" {
  billing_account = "012EEF-C61BAC-5A298A"
}

resource "google_billing_budget" "septims" {
  provider        = google.kalimdor
  billing_account = data.google_billing_account.tinker.id
  display_name    = "Example Billing Budget"
  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(local.budget)
    }
  }
  dynamic "threshold_rules" {
    for_each = toset([
      for i in range(0, 1) :
      tostring(1 + i * 0.05)
    ])
    content {
      threshold_percent = tonumber(threshold_rules.key)
    }
  }
}

provider "google" {
  alias       = "dalaran"
  credentials = "${path.module}/../../facts/gcp.dalaran.env.json"
  project     = "dalaran-3"
}

resource "google_monitoring_notification_channel" "potm" {
  provider     = google.dalaran
  display_name = "wall_st"
  type         = "email"
  labels = {
    email_address = var.mein_email
  }
}

data "google_billing_account" "tinker" {
  provider        = google.dalaran
  billing_account = "012EEF-C61BAC-5A298A"
}

resource "google_billing_budget" "septims" {
  provider        = google.dalaran
  billing_account = data.google_billing_account.tinker.id
  all_updates_rule {
    disable_default_iam_recipients = true
    monitoring_notification_channels = [
      google_monitoring_notification_channel.potm.id,
    ]
  }
  amount {
    specified_amount {
      units = tostring(local.budget)
    }
  }
  dynamic "threshold_rules" {
    for_each = toset([
      for i in range(0, 9) :
      tostring(1 + i * 0.05)
    ])
    content {
      threshold_percent = tonumber(threshold_rules.key)
    }
  }
}

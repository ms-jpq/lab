# resource "google_monitoring_notification_channel" "wall_st" {
#   project      = local.gcp_project
#   display_name = "wall_st"
#   type         = "email"
#   labels = {
#     email_address = var.mein_email
#   }
# }

# resource "google_billing_budget" "septims" {
#   billing_account = local.gcp_billing_account
#   all_updates_rule {
#     disable_default_iam_recipients = true
#     monitoring_notification_channels = [
#       google_monitoring_notification_channel.wall_st.id
#     ]
#   }
#   amount {
#     specified_amount {
#       currency_code = "USD"
#       units         = tostring(local.budget)
#     }
#   }
#   budget_filter {
#     calendar_period = "MONTH"
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


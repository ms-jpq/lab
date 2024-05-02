variable "mein_email" {
  type = string
}

variable "gcp_billing_account" {
  type = string
}

locals {
  budget = 10
}

resource "aws_budgets_budget" "septims" {
  budget_type  = "COST"
  limit_amount = local.budget
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset([
      for i in range(0, 9) :
      tostring(100 + i * 50)
    ])
    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.mein_email]
      threshold                  = tonumber(notification.key)
      threshold_type             = "PERCENTAGE"
    }
  }
}

output "bezos" {
  value = {
    freedom_fries = aws_budgets_budget.septims.limit_amount
    warn = [
      for notif in aws_budgets_budget.septims.notification :
      notif.threshold / 100 * aws_budgets_budget.septims.limit_amount
    ]
  }
}

data "google_iam_role" "bill_gates" {
  provider = google.ca_e2
  name     = "roles/billing.admin"
}

# gcloud auth application-default login
resource "google_billing_account_iam_member" "tinker" {
  provider           = google.ca_e2
  billing_account_id = var.gcp_billing_account
  member             = "serviceAccount:${data.google_service_account.whoami.email}"
  role               = data.google_iam_role.bill_gates.name
}

# resource "google_billing_budget" "septims" {
#   provider        = google.ca_e2
#   billing_account = var.gcp_billing_account
#   amount {
#     specified_amount {
#       currency_code = "USD"
#       units         = local.budget
#     }
#   }
#   dynamic "threshold_rules" {
#     for_each = toset([
#       for i in range(0, 9) :
#       tostring(1 + i * 0.05)
#     ])
#     content {
#       threshold_percent = tonumber(threshold_rules.key)
#     }
#   }
# }

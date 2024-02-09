variable "mein_email" {
  type = string
}

resource "aws_budgets_budget" "septims" {
  budget_type  = "COST"
  limit_amount = 10
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset(["25", "50", "100", "150", "200", "250", "300"])
    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.mein_email]
      threshold                  = tonumber(notification.key)
      threshold_type             = "PERCENTAGE"
    }
  }
}

output "dong" {
  value = {
    freedom_fries = aws_budgets_budget.septims.limit_amount
    threshold = [
      for notif in aws_budgets_budget.septims.notification :
      notif.threshold / 100 * aws_budgets_budget.septims.limit_amount
    ]
  }
}

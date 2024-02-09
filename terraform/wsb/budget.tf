variable "mein_email" {
  type = string
}

resource "aws_budgets_budget" "septims" {
  budget_type  = "COST"
  limit_amount = 10
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = toset(["10", "50", "100"])
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
    limit = aws_budgets_budget.septims.limit_amount
    alerts = [
      for notif in aws_budgets_budget.septims.notification :
      notif.threshold / 100 * aws_budgets_budget.septims.limit_amount
    ]
  }
}

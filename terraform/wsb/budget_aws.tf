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
  # sensitive = true
  value = {
    freedom_fries = aws_budgets_budget.septims.limit_amount
    # warn = [
    #   for notif in aws_budgets_budget.septims.notification :
    #   notif.threshold / 100 * aws_budgets_budget.septims.limit_amount
    # ]
  }
}

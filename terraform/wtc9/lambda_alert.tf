resource "aws_sns_topic" "siphon" {
  region = aws_dynamodb_table.mango.region
}

resource "aws_sns_topic_subscription" "siphon" {
  endpoint  = var.email_alert
  protocol  = "email"
  region    = aws_sns_topic.siphon.region
  topic_arn = aws_sns_topic.siphon.arn
}


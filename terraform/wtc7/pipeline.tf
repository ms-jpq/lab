resource "aws_iam_role" "lambda_role" {
  name = "lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_s3_bucket" "email_bucket" {
  bucket = "my-email-bucket"
}

resource "aws_ses_domain_identity" "domain" {
  domain = "example.com"
}

resource "aws_ses_receipt_rule_set" "main" {
  rule_set_name = "main-rule-set"
}

resource "aws_ses_receipt_rule" "store" {
  name          = "store"
  rule_set_name = aws_ses_receipt_rule_set.main.rule_set_name
  recipients    = ["user@example.com"]
  enabled       = true
  scan_enabled  = true

  s3_action {
    bucket_name = aws_s3_bucket.email_bucket.id
    position    = 1
  }
}

resource "aws_lambda_function" "process_email" {
  filename      = "process_email.zip"
  function_name = "process-email"
  handler       = "index.handler"
  role          = aws_iam_role.lambda_role.arn
  runtime       = "nodejs14.x"

  environment {
    variables = {
      S3_BUCKET = aws_s3_bucket.email_bucket.id
    }
  }
}


# S3 event notification to trigger Lambda
resource "aws_s3_bucket_notification" "bucket_notification" {
  bucket = aws_s3_bucket.email_bucket.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_email.arn
    events              = ["s3:ObjectCreated:*"]
  }
}

resource "aws_cloudtrail" "main" {
  name                          = "main-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_bucket.id
  include_global_service_events = true

  event_selector {
    read_write_type           = "All"
    include_management_events = true

    data_resource {
      type   = "AWS::S3::Object"
      values = ["${aws_s3_bucket.email_bucket.arn}/"]
    }

    data_resource {
      type   = "AWS::Lambda::Function"
      values = [aws_lambda_function.process_email.arn]
    }
  }
}

resource "aws_s3_bucket" "cloudtrail_bucket" {
  bucket = "my-cloudtrail-bucket"
}

resource "aws_cloudwatch_event_rule" "cleanup_failed_invocations" {
  name                = "cleanup-failed-invocations"
  description         = "Clean up failed Lambda invocations"
  schedule_expression = "rate(1 day)"
}

resource "aws_cloudwatch_event_target" "cleanup_target" {
  rule = aws_cloudwatch_event_rule.cleanup_failed_invocations.name
  arn  = aws_lambda_function.cleanup_function.arn
}

resource "aws_lambda_function" "cleanup_function" {
  filename      = "cleanup_function.zip"
  function_name = "cleanup-failed-invocations"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs14.x"
}

resource "aws_s3_bucket" "maildir" {
  bucket = "kfc-maildir"
}

data "aws_iam_policy_document" "lamb" {
  statement {
    actions = ["s3:*"]
    effect  = "Allow"
    resources = flatten([
      for bucket in [aws_s3_bucket.maildir.bucket] : [
        "arn:aws:s3:::${bucket}/*"
    ]])
  }
}

resource "aws_iam_role" "lamb" {
  name               = "mta"
  assume_role_policy = data.aws_iam_policy_document.lamb.json
}

resource "aws_ses_domain_identity" "limited_void" {
  domain = var.email_domain
}

resource "aws_route53_record" "limited_void" {
  name    = "_amazonses.${aws_ses_domain_identity.limited_void.id}"
  records = [aws_ses_domain_identity.limited_void.verification_token]
  ttl     = 600
  type    = "TXT"
  zone_id = aws_route53_zone.limited_void.zone_id
}

resource "aws_ses_domain_identity_verification" "limited_void" {
  depends_on = [aws_route53_record.limited_void]
  domain     = aws_ses_domain_identity.limited_void.id
}

resource "aws_ses_receipt_rule_set" "router1" {
  rule_set_name = "router1"
}

resource "aws_ses_receipt_rule" "s3" {
  name          = "s3"
  rule_set_name = aws_ses_receipt_rule_set.router1.rule_set_name

  s3_action {
    bucket_name = aws_s3_bucket.maildir.id
    position    = 0
  }
}

# resource "aws_lambda_function" "process_email" {
#   filename      = "process_email.zip"
#   function_name = "process-email"
#   handler       = "index.handler"
#   role          = aws_iam_role.lamb.arn
#   runtime       = "python3.12"
#
#   environment {
#     variables = {
#       S3_BUCKET = aws_s3_bucket.maildir.id
#     }
#   }
# }
#
#
# # S3 event notification to trigger Lambda
# resource "aws_s3_bucket_notification" "bucket_notification" {
#   bucket = aws_s3_bucket.maildir.id
#
#   lambda_function {
#     lambda_function_arn = aws_lambda_function.process_email.arn
#     events              = ["s3:ObjectCreated:*"]
#   }
# }
#
# resource "aws_cloudtrail" "main" {
#   name                          = "main-trail"
#   s3_bucket_name                = aws_s3_bucket.cloudtrail_bucket.id
#   include_global_service_events = true
#
#   event_selector {
#     read_write_type           = "All"
#     include_management_events = true
#
#     data_resource {
#       type   = "AWS::S3::Object"
#       values = ["${aws_s3_bucket.maildir.arn}/"]
#     }
#
#     data_resource {
#       type   = "AWS::Lambda::Function"
#       values = [aws_lambda_function.process_email.arn]
#     }
#   }
# }
#
# resource "aws_s3_bucket" "cloudtrail_bucket" {
#   bucket = "my-cloudtrail-bucket"
# }
#
# resource "aws_cloudwatch_event_rule" "cleanup_failed_invocations" {
#   name                = "cleanup-failed-invocations"
#   description         = "Clean up failed Lambda invocations"
#   schedule_expression = "rate(1 day)"
# }
#
# resource "aws_cloudwatch_event_target" "cleanup_target" {
#   rule = aws_cloudwatch_event_rule.cleanup_failed_invocations.name
#   arn  = aws_lambda_function.cleanup_function.arn
# }
#
# resource "aws_lambda_function" "cleanup_function" {
#   filename      = "cleanup_function.zip"
#   function_name = "cleanup-failed-invocations"
#   role          = aws_iam_role.lamb.arn
#   handler       = "index.handler"
#   runtime       = "nodejs14.x"
# }

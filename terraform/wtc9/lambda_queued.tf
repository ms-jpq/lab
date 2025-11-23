resource "aws_sqs_queue" "sink" {
  region = aws_apigatewayv2_api.faas.region
}

resource "aws_sqs_queue" "drain" {
  region = aws_sqs_queue.sink.region
}

resource "aws_apigatewayv2_integration" "sink" {
  api_id              = aws_apigatewayv2_api.faas.id
  credentials_arn     = aws_iam_role.api_gateway_sqs.arn
  integration_subtype = "SQS-SendMessage"
  integration_type    = "AWS_PROXY"
  region              = aws_apigatewayv2_api.faas.region

  request_parameters = {
    QueueUrl    = aws_sqs_queue.sink.id
    MessageBody = "$request.body"
    MessageAttributes = jsonencode({
      TraceParent = {
        DataType    = "String"
        StringValue = "$${context.authorizer.traceparent}"
      }
      Signature = {
        DataType    = "String"
        StringValue = "$${context.authorizer.signature}"
      }
      Method = {
        DataType    = "String"
        StringValue = "$${context.httpMethod}"
      }
      RawURL = {
        DataType    = "String"
        StringValue = "$${request.header.x-forwarded-proto}://$${context.domainName}$${request.path}"
      }
    })
  }
}

resource "aws_sqs_queue_redrive_allow_policy" "pipe" {
  queue_url = aws_sqs_queue.drain.id
  region    = aws_sqs_queue.drain.region

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue",
    sourceQueueArns   = [aws_sqs_queue.sink.arn]
  })
}

resource "aws_sqs_queue_redrive_policy" "pipe" {
  queue_url = aws_sqs_queue.sink.id
  region    = aws_sqs_queue.sink.region

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.drain.arn
    maxReceiveCount     = 2
  })
}

data "aws_iam_policy_document" "skyhook" {
  statement {
    actions   = ["sns:Publish"]
    effect    = "Allow"
    resources = [aws_sns_topic.siphon.arn]
  }
  statement {
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    effect    = "Allow"
    resources = [aws_sqs_queue.sink.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:DeleteObject", "s3:ListBucket"]
    effect    = "Allow"
    resources = ["${data.aws_s3_bucket.maildir.arn}/*"]
  }
}

resource "aws_lambda_function" "skyhook" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.nop.output_path
  function_name    = "skyhook"
  handler          = "faas.skyhook.main"
  layers           = local.lambda_layers
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["skyhook"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.nop.output_base64sha256

  environment {
    variables = merge(
      local.lambda_envs,
      {
        ENV_CHAN_NAME    = aws_sns_topic.siphon.arn
        ENV_TWILIO_TOKEN = var.twilio_token
      },
      {
        MAIL_FROM = var.mail_from
        MAIL_TO   = join(", ", var.mail_to)
        MAIL_SRV  = local.mail_srv
        MAIL_USER = var.mail_user
        MAIL_PASS = var.mail_pass
        MAIL_FILT = var.mail_filter
      }
    )
  }
}

resource "aws_lambda_event_source_mapping" "skyhook" {
  event_source_arn = aws_sqs_queue.sink.arn
  function_name    = aws_lambda_function.skyhook.arn
  region           = aws_lambda_function.skyhook.region
}

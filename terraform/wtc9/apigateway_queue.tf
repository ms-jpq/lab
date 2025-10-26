resource "aws_sqs_queue" "sink" {
  provider = aws.ca_w1
}

resource "aws_apigatewayv2_api" "skyhook" {
  provider      = aws.ca_w1
  name          = "skyhook"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  provider    = aws.ca_w1
  api_id      = aws_apigatewayv2_api.skyhook.id
  auto_deploy = true
  name        = "$default"
}

resource "aws_apigatewayv2_integration" "tube" {
  provider            = aws.ca_w1
  api_id              = aws_apigatewayv2_api.skyhook.id
  credentials_arn     = aws_iam_role.api_gateway_sqs.arn
  integration_subtype = "SQS-SendMessage"
  integration_type    = "AWS_PROXY"

  request_parameters = {
    QueueUrl    = aws_sqs_queue.sink.id
    MessageBody = "$request.body"
    MessageAttributes = jsonencode({
      Method = {
        DataType    = "String"
        StringValue = "$${context.httpMethod}"
      }
      Path = {
        DataType    = "String"
        StringValue = "$${request.path}"
      }
    })
  }
}

resource "aws_apigatewayv2_route" "umbrella" {
  provider           = aws.ca_w1
  api_id             = aws_apigatewayv2_api.skyhook.id
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.okta.id
  route_key          = "$default"
  target             = "integrations/${aws_apigatewayv2_integration.tube.id}"
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.skyhook.api_endpoint
  }
}

output "logging" {
  value = {
    auth    = "aws --region ${local.aws_regions.ca_w1} logs tail ${aws_cloudwatch_log_group.okta.name} --follow"
    skyhook = "aws --region ${local.aws_regions.ca_w1} logs tail ${aws_cloudwatch_log_group.okta.name} --follow"
  }
}

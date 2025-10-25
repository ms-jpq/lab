resource "aws_sqs_queue" "sink" {
  provider = aws.ca_w1
}

resource "aws_apigatewayv2_api" "funnel" {
  provider      = aws.ca_w1
  name          = "funnel"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  provider    = aws.ca_w1
  api_id      = aws_apigatewayv2_api.funnel.id
  auto_deploy = true
  name        = "$default"
}

resource "aws_apigatewayv2_integration" "tube" {
  provider            = aws.ca_w1
  api_id              = aws_apigatewayv2_api.funnel.id
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
  provider  = aws.ca_w1
  api_id    = aws_apigatewayv2_api.funnel.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.tube.id}"
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.funnel.api_endpoint
  }
}

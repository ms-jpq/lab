resource "aws_sqs_queue" "sink" {
}

resource "aws_apigatewayv2_api" "funnel" {
  name          = "funnel"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "one_wtc" {
  api_id      = aws_apigatewayv2_api.funnel.id
  auto_deploy = true
  name        = "$default"
}

resource "aws_apigatewayv2_integration" "tube" {
  api_id              = aws_apigatewayv2_api.funnel.id
  credentials_arn     = aws_iam_role.api_gateway_sqs.arn
  integration_subtype = "SQS-SendMessage"
  integration_type    = "AWS_PROXY"

  request_parameters = {
    QueueUrl    = aws_sqs_queue.sink.id
    MessageBody = "$request.body"
    MessageAttributes = jsonencode({
      method = {
        DataType    = "String"
        StringValue = "$${request.method}"
      }
      path = {
        DataType    = "String"
        StringValue = "$${request.path}"
      }
      headers = {
        DataType    = "String"
        StringValue = "$${request.header.*}"
      }
    })
  }
}

resource "aws_apigatewayv2_route" "umbrella" {
  api_id    = aws_apigatewayv2_api.funnel.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.tube.id}"
}

output "apigateway" {
  value = {
    endpoint = aws_apigatewayv2_api.funnel.api_endpoint
  }
}

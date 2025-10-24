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
  integration_subtype = "SQS-SendMessage"
  integration_type    = "AWS_PROXY"

  request_parameters = {
    QueueUrl = aws_sqs_queue.sink.id
    MessageBody =jsonencode({
      body        = "$request.body"
      headers     = "$request.header"
      method      = "$context.httpMethod"
      path        = "$context.path"
      queryString = "$request.querystring"
    })
  }
}

resource "aws_apigatewayv2_route" "umbrella" {
  api_id    = aws_apigatewayv2_api.funnel.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.tube.id}"
}

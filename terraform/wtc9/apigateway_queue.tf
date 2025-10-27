resource "aws_sqs_queue" "sink" {
  region = aws_apigatewayv2_api.faas.region
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

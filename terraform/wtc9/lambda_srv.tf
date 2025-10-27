resource "aws_lambda_function" "ppv" {
  architectures    = [local.lambda_arch]
  filename         = data.archive_file.haskell.output_path
  function_name    = "ppv"
  handler          = "ppv.entry.main"
  layers           = [local.lambda_layer]
  region           = local.lambda_region
  role             = aws_iam_role.lambdas["ppv"].arn
  runtime          = local.lambda_rt
  source_code_hash = data.archive_file.haskell.output_base64sha256

  environment {
    variables = {}
  }
}

resource "aws_lambda_event_source_mapping" "ppv" {
  event_source_arn = aws_sqs_queue.sink.arn
  function_name    = aws_lambda_function.skyhook.arn
  region           = local.lambda_region
}

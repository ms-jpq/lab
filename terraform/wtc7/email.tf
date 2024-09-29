resource "aws_s3_bucket" "maildir" {
  provider = aws.us_e1
  bucket   = "kfc-maildir"
}

resource "aws_sqs_queue" "mbox" {
  provider = aws.us_e1
}

resource "aws_sqs_queue" "dns" {
  provider = aws.us_e1
}

data "archive_file" "mta" {
  output_path = "${path.module}/../../var/mta.zip"
  source_dir  = "${path.module}/mta"
  type        = "zip"
}

resource "aws_lambda_function" "mta" {
  provider         = aws.us_e1
  architectures    = ["arm64"]
  filename         = data.archive_file.mta.output_path
  function_name    = basename(data.archive_file.mta.source_dir)
  handler          = "handler"
  role             = aws_iam_role.mta.arn
  runtime          = "python3.12"
  source_code_hash = data.archive_file.mta.output_base64sha256
}

resource "aws_lambda_function_event_invoke_config" "mta" {
  provider      = aws.us_e1
  depends_on    = [aws_sqs_queue_policy.qq]
  function_name = aws_lambda_function.mta.function_name

  destination_config {
    on_failure {
      destination = aws_sqs_queue.dns.arn
    }
  }
}

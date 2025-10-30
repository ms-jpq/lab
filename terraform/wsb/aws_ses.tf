locals {
  # https://docs.aws.amazon.com/general/latest/gr/ses.html
  mail_srv = "email-smtp.${local.aws_regions.ca_c1}.amazonaws.com"
}

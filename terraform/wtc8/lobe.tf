variable "lobe_users" {
  type = map(string)
}

resource "auth0_client" "lobe" {
  name      = "lobechat"
  app_type  = "spa"
  callbacks = ["https://chat.${var.auth0_lobechat_domain}/api/auth/callback/auth0"]
}

data "auth0_client" "lobe" {
  client_id = auth0_client.lobe.client_id
}

resource "auth0_user" "lobee" {
  for_each        = { for user, pw in var.lobe_users : "${user}@${var.vps_domain}" => pw }
  connection_name = "Username-Password-Authentication"
  email           = each.key
  email_verified  = true
  password        = each.value
}

resource "local_sensitive_file" "lobe" {
  filename = "${path.module}/../../facts/lobechat.auth0.env"
  content  = <<-INI
  ENV_AUTH_AUTH0_ID='${data.auth0_client.lobe.client_id}'
  ENV_AUTH_AUTH0_ISSUER='https://${var.auth0_domain}'
  ENV_AUTH_AUTH0_SECRET='${data.auth0_client.lobe.client_secret}'
  INI
}

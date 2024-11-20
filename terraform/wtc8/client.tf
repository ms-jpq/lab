variable "lobe_users" {
  type = map(string)
}

resource "auth0_client" "lobe" {
  name      = "lobechat"
  app_type  = "spa"
  callbacks = ["https://${var.vps_domain}/api/auth/callback/auth0"]
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
  filename = "${path.module}/../../facts/lobechat.env.yaml"
  content = yamlencode({
    AUTH_AUTH0_ID     = data.auth0_client.lobe.client_id
    AUTH_AUTH0_ISSUER = "https://${var.auth0_domain}"
    AUTH_AUTH0_SECRET = data.auth0_client.lobe.client_secret
  })
}

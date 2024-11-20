variable "lobe_users" {
  type = map(string)
}


resource "auth0_client" "lobe" {
  name      = "lobechat"
  app_type  = "spa"
  callbacks = ["https://${var.vps_domain}/api/auth/callback/auth0"]
}

resource "auth0_user" "lobee" {
  for_each        = { for user, pw in var.lobe_users : "${user}@${var.vps_domain}" => pw }
  connection_name = "Username-Password-Authentication"
  email           = each.key
  email_verified  = true
  password        = each.value
}

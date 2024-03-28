/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

/**
 * @param {NginxHTTPRequest} request
 */
const rate_limit = async (request) => {
  const {
    ["Auth-Pass"]: auth_password = "",
    ["Auth-Protocol"]: auth_protocol,
    ["Auth-Smtp-To"]: smtp_to = "",
    ["Auth-User"]: auth_user = "",
    ["Client-Ip"]: client_ip,
  } = request.headersIn;

  if (!client_ip) {
    return request.return(400);
  }

  switch (auth_protocol) {
    case "smtp":
      if (smtp_to.indexOf("/") !== -1) {
        request.headersOut["Auth-Error-Code"] = "553";
        request.headersOut["Auth-Status"] =
          "Requested action not taken: mailbox name not allowed";
      } else {
        request.headersOut["Auth-Port"] = "2525";
        request.headersOut["Auth-Server"] = "127.0.0.53";
        request.headersOut["Auth-Status"] = "OK";
      }
      return request.return(200);
    case "imap":
      const basic = Buffer.from(`${auth_user}:${auth_password}`).toString(
        "base64",
      );
      const resp = await fetch(
        "http://unix:/run/local/nginx/direct_auth.sock",
        {
          headers: {
            "X-Real-IP": client_ip,
            Authorization: `Basic ${basic}`,
          },
        },
      );
      if (resp.ok) {
        request.headersOut["Auth-Port"] = "1443";
        request.headersOut["Auth-Server"] = "127.0.0.53";
        request.headersOut["Auth-Status"] = "OK";
      } else {
        request.headersOut["Auth-Error-Code"] = "535 5.7.8";
        request.headersOut["Auth-Status"] =
          "Authentication credentials invalid";
      }
      return request.return(200);
    default:
      return request.return(400);
  }
};

export default { rate_limit };

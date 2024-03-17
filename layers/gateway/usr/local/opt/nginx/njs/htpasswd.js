/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

/**
 * @param {NginxHTTPRequest} request
 */
const rate_limit = (request) => {
  const zone = ngx.shared.rate_limit;
  if (!zone) {
    request.return(502);
  } else {
    request.remoteAddress;
  }
};

export default { rate_limit };

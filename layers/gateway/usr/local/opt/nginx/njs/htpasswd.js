/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

const die = 3;

// js_shared_dict_zone zone=rate_limit:1M timeout=60s type=number evict;

/**
 * @param {NginxHTTPRequest} request
 */
const rate_limit = async (request) => {
  const failed_zone = ngx.shared.rate_limit;
  if (!failed_zone) {
    request.return(502);
  } else {
    const quads = request.remoteAddress.split(":").slice(0, 4);
    const key = quads.join(":");
    if (Number(failed_zone.get(key)) >= die) {
      request.return(429);
    } else {
      try {
        const { status } = await request.subrequest("/auth");
        if (status >= 200 && status <= 299) {
          failed_zone.delete(key);
        } else {
          failed_zone.incr(key, 1, 0);
        }
        request.return(status);
      } catch {
        request.return(502);
      }
    }
  }
};

export default { rate_limit };

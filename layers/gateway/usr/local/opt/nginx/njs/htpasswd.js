/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

import cr from "crypto";
import fs from "fs";

const ALGORITHM = "sha256";
const SUBREQ = "/-_-validate";

/**
 * @param {string} key
 * @param {string} dflt
 */
const envStr = (key, dflt) => process.env[key] ?? dflt;

/**
 * @param {string} key
 * @param {number} dflt
 */
const envInt = (key, dflt) => Number(process.env[key] ?? dflt);

const COOKIE_NAME = envStr("HTPASSWD_COOKIE_NAME", "htpasswd");
const COOKIE_TTL = envInt("HTPASSWD_COOKIE_TTL", 1209600);
const DOMAIN_PARTS = envInt("HTPASSWD_DOMAIN_PARTS", 2);
const HMAC_SECRET = envStr("HTPASSWD_SECRET", "");

const ALLOW_RES = (() => {
  const dir = process.env.HTPASSWD_ALLOW_LIST;
  if (!dir) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .flatMap((name) => fs.readFileSync(`${dir}/${name}`, "utf8").split("\n"))
    .map((line) => line.trim())
    .filter((line) => line.length)
    .map((l) => new RegExp(`^${l}$`));
})();

/** @param {string} host_path */
const matchAllow = (host_path) => ALLOW_RES.some((re) => re.test(host_path));

/**
 * @param {NginxHTTPRequest} r
 * @returns {NginxHTTPRequest}
 */
const origin = (r) => (r.parent ? origin(r.parent) : r);

/** @param {Buffer} buf */
const b64encode = (buf) => buf.toString("base64");

/** @param {string} s */
const b64decode = (s) => Buffer.from(s, "base64");

/** @param {Buffer} plain */
const digest = (plain) =>
  Buffer.from(cr.createHmac(ALGORITHM, HMAC_SECRET).update(plain).digest());

/** @param {string} s */
const removeWs = (s) => s.replace(/\s+/g, "");

/**
 * @param {Buffer} a
 * @param {Buffer} b
 */
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return mismatch === 0;
};

/** @param {boolean} secure */
const cookieName = (secure) =>
  secure ? `__Secure-${COOKIE_NAME}` : COOKIE_NAME;

/** @param {string} data */
const encodeCookieValue = (data) => {
  const buf = Buffer.from(data, "utf8");
  const sig = b64encode(digest(buf));
  const plain = b64encode(buf);
  return `${sig}.${plain}`;
};

/** @param {string} value */
const decodeCookieValue = (value) => {
  const dot = value.indexOf(".");
  if (dot < 0) {
    return undefined;
  }
  const sig = b64decode(value.slice(0, dot));
  const plain = b64decode(value.slice(dot + 1));
  return timingSafeEqual(sig, digest(plain))
    ? plain.toString("utf8")
    : undefined;
};

/**
 * @param {NginxHeadersIn} headersIn
 * @param {boolean} secure
 */
const readAuthCookie = (headersIn, secure) => {
  const header = headersIn["Cookie"];
  if (!header) {
    return false;
  }
  const name = cookieName(secure);
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const cName = part.slice(0, eq).trim();
    if (cName !== name) {
      continue;
    }

    const cValue = part.slice(eq + 1).trim();
    const plain = decodeCookieValue(cValue);
    if (plain === undefined) {
      continue;
    }
    const sep = plain.lastIndexOf(":");
    if (sep < 0) {
      continue;
    }

    const exp = Number(plain.slice(sep + 1));
    if (Number.isFinite(exp) && exp - Date.now() / 1000 >= 0) {
      return true;
    }
  }
  return false;
};

/**
 * @param {NginxHTTPRequest} o
 * @param {string} user
 */
const buildCookie = (o, user) => {
  const host = o.headersIn["Host"] ?? "";
  const secure = isSecure(o);
  const parts = function* () {
    const exp = Math.round(Date.now() / 1000) + COOKIE_TTL;
    yield `${cookieName(secure)}=${encodeCookieValue(`${user}:${exp}`)}`;
    yield `Domain=${host.split(".").slice(-DOMAIN_PARTS).join(".")}`;
    yield `Expires=${new Date(exp * 1000).toUTCString()}`;
    yield `Max-Age=${COOKIE_TTL}`;
    yield "Path=/";
    yield "SameSite=Strict";
    if (secure) {
      yield "Secure";
    }
    yield "HttpOnly";
    return;
  };

  return [...parts()].join("; ");
};

/** @param {NginxHeadersIn} headersIn */
const parseAuth = (headersIn) => {
  const header = headersIn["Authorization"];
  if (!header) {
    return undefined;
  }

  const sep = header.indexOf(" ");
  if (sep < 0) {
    return undefined;
  }

  const scheme = header.slice(0, sep).toLowerCase();
  if (scheme !== "basic") {
    return undefined;
  }
  const creds = header.slice(sep + 1).trim();

  const decoded = b64decode(creds).toString("utf8");
  const colon = decoded.indexOf(":");
  const user = removeWs(colon < 0 ? decoded : decoded.slice(0, colon));
  return { user, creds };
};

/**
 * @param {NginxHTTPRequest} r
 * @param {string} creds
 * @param {string} ip
 */
const validate = async (r, creds, ip) => {
  r.variables.htpasswd_authz = `Basic ${creds}`;
  r.variables.htpasswd_ip = ip;

  const reply = await r.subrequest(SUBREQ, { method: "GET" });
  return reply.status >= 200 && reply.status < 300;
};

/** @param {NginxHTTPRequest} o */
const isSecure = (o) => (o.variables.scheme ?? "").toLowerCase() !== "http";

/** @param {string | undefined} raw */
const maskIp = (raw) => {
  if (!raw) {
    return "";
  }
  if (raw === "unix:") {
    return "::";
  }
  return raw;
};

/** @param {NginxHTTPRequest} o */
const clientIp = (o) =>
  maskIp(o.remoteAddress ?? o.headersIn["X-Real-IP"] ?? "");

export default {
  /** @param {NginxHTTPRequest} r */
  gate: async (r) => {
    const o = origin(r);
    const host = o.headersIn["Host"] ?? "";
    const secure = isSecure(o);
    const uri = o.variables.request_uri ?? "/";

    const ok = await (async () => {
      if (matchAllow(host + uri) || readAuthCookie(o.headersIn, secure)) {
        return true;
      }
      const parsed = parseAuth(o.headersIn);
      return parsed && (await validate(r, parsed.creds, clientIp(o)));
    })();

    if (ok) {
      return r.return(204);
    }

    const accept = (o.headersIn["Accept"] ?? "").toLowerCase();
    if (!accept.includes("html")) {
      r.headersOut["WWW-Authenticate"] = 'Basic realm="-"';
    }
    return r.return(401);
  },
  /** @param {NginxHTTPRequest} r */
  login: async (r) => {
    const o = origin(r);
    const params = new URLSearchParams(r.requestText ?? "");
    const username = removeWs(params.get("username") ?? "");

    const creds = (() => {
      const password = params.get("password") ?? "";
      return b64encode(Buffer.from(`${username}:${password}`, "utf8"));
    })();
    const ip = clientIp(o);
    const ok = await validate(r, creds, ip);

    if (!ok) {
      return r.return(401);
    }

    r.headersOut["Set-Cookie"] = [buildCookie(o, username)];

    const redirect = removeWs(params.get("redirect") ?? "");
    if (redirect) {
      r.headersOut["Location"] = redirect;
      r.headersOut["X-Original-URL"] = redirect;
      return r.return(303);
    }

    return r.return(204);
  },
};

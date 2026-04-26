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

/** @param {NginxHTTPRequest} o */
const isSecure = (o) => (o.variables.scheme ?? "").toLowerCase() !== "http";

/** @param {string} raw */
const maskIp = (raw) => (raw === "unix:" ? "::" : raw);

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
  const buf = Buffer.from(data);
  const sig = digest(buf).toString("base64");
  const plain = buf.toString("base64");
  return `${sig}.${plain}`;
};

/** @param {string} value */
const decodeCookieValue = (value) => {
  const dot = value.indexOf(".");
  if (dot < 0) {
    return undefined;
  }
  const sig = Buffer.from(value.slice(0, dot), "base64");
  const plain = Buffer.from(value.slice(dot + 1), "base64");
  return timingSafeEqual(sig, digest(plain)) ? plain.toString() : undefined;
};

/** @param {NginxHTTPRequest} o */
const readAuthCookie = (o) => {
  const header = o.headersIn["Cookie"];
  if (!header) {
    return false;
  }

  const name = cookieName(isSecure(o));
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
    const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL;
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

/** @param {NginxHTTPRequest} o */
const parseAuth = (o) => {
  const header = o.headersIn["Authorization"];
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

  const decoded = Buffer.from(creds, "base64").toString();
  const colon = decoded.indexOf(":");
  const user = removeWs(colon < 0 ? decoded : decoded.slice(0, colon));
  return { user, creds };
};

/**
 * @param {NginxHTTPRequest} r
 * @param {string} creds
 * @param {NginxHTTPRequest} o
 */
const validateWithSubRequest = async (r, creds, o) => {
  const ip = o.remoteAddress ?? "";
  r.variables.htpasswd_authz = `Basic ${creds}`;
  r.variables.htpasswd_ip = maskIp(ip);

  const reply = await r.subrequest(SUBREQ, { method: "GET" });
  return reply.status >= 200 && reply.status < 300;
};

export default {
  /** @param {NginxHTTPRequest} r */
  gate: async (r) => {
    const o = origin(r);
    const host = o.headersIn["Host"] ?? "";
    const uri = o.variables.request_uri ?? "/";

    if (matchAllow(host + uri) || readAuthCookie(o)) {
      return r.return(204);
    }

    const parsed = parseAuth(o);
    if (parsed && (await validateWithSubRequest(r, parsed.creds, o))) {
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

    const password = params.get("password") ?? "";
    const creds = Buffer.from(`${username}:${password}`).toString("base64");
    if (!(await validateWithSubRequest(r, creds, o))) {
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

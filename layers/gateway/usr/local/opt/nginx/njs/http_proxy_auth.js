/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

import cr from "crypto"
import fs from "fs"
import qs from "querystring"

const ALGORITHM = "sha256"
const SUBREQ = "/-_-validate"
const COOKIE_NAME = "htpasswd"
const COOKIE_TTL = 60 * 60 * 24 * 7 * 2
const DOMAIN_PARTS = 2
const LOCAL_PATH_RE = /^\/(?![\/\\])/
const TAB_OR_NEWLINE_RE = /[\t\n\r]/
const INVALID_FORWARDED_USER_CHAR_RE = /[:\x00-\x1f\x7f]/
const HMAC_SECRET =
  process.env["HTPASSWD_SECRET"] ||
  (() => {
    throw new Error()
  })()

const ALLOW_REX = (() => {
  /** @type {RegExp[]} */
  const acc = []

  const dir = "/var/lib/local/htpasswd"
  fs.readdirSync(dir)
    .filter((name) => name.endsWith(".txt"))
    .forEach((name) => {
      fs.readFileSync(`${dir}/${name}`, "utf8")
        .split("\n")
        .forEach((raw) => {
          const line = raw.trim()
          if (!line) {
            return
          }

          const slash = line.indexOf("/")
          const pat = line
            .split("")
            .map((c, i) => {
              const hostname = slash === -1 || i < slash
              switch (true) {
                case hostname && c === "*":
                  return "[^/?]*"
                case c === "*":
                  return ".*"
                case hostname && c === "?":
                  return "[^/?]"
                case c === "?":
                  return "."
                case /[.+^${}()|[\]\\]/.test(c):
                  return "\\" + c
                default:
                  return c
              }
            })
            .join("")

          const re = new RegExp(`^${pat}${slash === -1 ? "/.*" : ""}$`)
          acc.push(re)
        })
    })

  return acc
})()

/** @param {string} host_path */
const matchAllow = (host_path) => ALLOW_REX.some((re) => re.test(host_path))

/** @param {string} value */
const escapeHtml = (value) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")

/**
 * @param {string} domain
 * @param {Buffer} plain
 */
const digest = (domain, plain) =>
  Buffer.from(
    cr
      .createHmac(ALGORITHM, HMAC_SECRET)
      .update(`\x00${domain}\x00`)
      .update(plain)
      .digest(),
  )

/** @param {NginxHTTPRequest} r */
const cookieDomain = (r) =>
  (r.variables.host ?? "").split(".").slice(-DOMAIN_PARTS).join(".")

/**
 * @param {string} s
 * @param {string} sep
 * @param {boolean} [last]
 * @returns {[string, string] | undefined}
 */
const partition = (s, sep, last) => {
  const i = last ? s.lastIndexOf(sep) : s.indexOf(sep)
  return i < 0 ? undefined : [s.slice(0, i), s.slice(i + sep.length)]
}

/** @param {string} s */
const removeWs = (s) => s.replace(/\s+/g, "")

/** @param {string | string[] | undefined} v */
const stringOrEmpty = (v) => (typeof v === "string" ? v : "")

/** @param {NginxHTTPRequest} r */
const isSecure = (r) => (r.variables.scheme ?? "").toLowerCase() !== "http"

/**
 * @param {Buffer} a
 * @param {Buffer} b
 */
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) {
    return false
  }
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0)
  }
  return mismatch === 0
}

/** @param {boolean} secure */
const cookieName = (secure) =>
  secure ? `__Secure-${COOKIE_NAME}` : COOKIE_NAME

/**
 * @param {string} domain
 * @param {string} data
 */
const encodeCookieValue = (domain, data) => {
  const buf = Buffer.from(data)
  const sig = digest(domain, buf).toString("base64")
  const plain = buf.toString("base64")
  return `${sig}.${plain}`
}

/**
 * @param {string} domain
 * @param {string} value
 */
const decodeCookieValue = (domain, value) => {
  const sigPlain = partition(value, ".")
  if (!sigPlain) {
    return undefined
  }
  const sig = Buffer.from(sigPlain[0], "base64")
  const plain = Buffer.from(sigPlain[1], "base64")
  return timingSafeEqual(sig, digest(domain, plain))
    ? plain.toString()
    : undefined
}

/** @param {string} user */
const parseUser = (user) =>
  user && user === user.trim() && !INVALID_FORWARDED_USER_CHAR_RE.test(user)
    ? user
    : undefined

/** @param {NginxHTTPRequest} r */
const cookieUser = (r) => {
  const name = cookieName(isSecure(r))
  const parts = (r.headersIn["Cookie"] ?? "").split(";")

  return parts.reduce((user, part) => {
    if (user) {
      return user
    }
    const nameValue = partition(part, "=")
    if (!nameValue || nameValue[0].trim() !== name) {
      return undefined
    }
    const plain = decodeCookieValue(cookieDomain(r), nameValue[1].trim())
    if (!plain) {
      return undefined
    }
    const userExp = partition(plain, ":", true)
    if (!userExp) {
      return undefined
    }
    const exp = Number(userExp[1])
    return Number.isFinite(exp) && exp > Date.now()
      ? parseUser(userExp[0])
      : undefined
  }, /** @type {string | undefined} */ (undefined))
}

/**
 * @param {NginxHTTPRequest} r
 * @param {string} user
 */
const buildCookie = (r, user) => {
  const domain = cookieDomain(r)
  const secure = isSecure(r)
  const exp = Math.round(Date.now() + COOKIE_TTL * 1000)

  const morsels = [
    `${cookieName(secure)}=${encodeCookieValue(domain, `${user}:${exp}`)}`,
    `Domain=${domain}`,
    `Expires=${new Date(exp).toUTCString()}`,
    `Max-Age=${COOKIE_TTL}`,
    "Path=/",
    "SameSite=Strict",
    "HttpOnly",
  ]
  if (secure) {
    morsels.push("Secure")
  }

  return morsels.join("; ")
}

/** @param {NginxHTTPRequest} r */
const basicUser = async (r) => {
  const header = r.headersIn["Authorization"]
  if (!header) {
    return undefined
  }

  const schemeCreds = partition(header, " ")
  if (!schemeCreds || schemeCreds[0].toLowerCase() !== "basic") {
    return undefined
  }
  const creds = schemeCreds[1].trim()
  if (!(await validate(r, creds))) {
    return undefined
  }

  const decoded = Buffer.from(creds, "base64").toString()
  const userPass = partition(decoded, ":")
  return userPass ? parseUser(userPass[0]) : undefined
}

/**
 * @param {NginxHTTPRequest} r
 * @param {string} creds
 */
const validate = async (r, creds) => {
  const ip = r.remoteAddress ?? ""
  r.variables["htpasswd_authz"] = `Basic ${creds}`
  r.variables["htpasswd_ip"] = ip === "unix:" ? "::" : ip

  const reply = await r.subrequest(SUBREQ, { method: "GET" })
  return reply.status >= 200 && reply.status < 300
}

export default {
  /** @param {NginxHTTPRequest} r */
  loginRedirect: (r) => escapeHtml(r.variables.request_uri ?? "/"),

  /** @param {NginxHTTPRequest} r */
  loginUser: (r) => escapeHtml(r.variables["upstream_http_x_auth_user"] ?? ""),

  /** @param {NginxHTTPRequest} r */
  gate: async (r) => {
    const uri =
      (r.variables.host ?? "") +
      (r.variables["htpasswd_request_uri"] ?? r.variables.uri ?? "/")

    if (matchAllow(uri)) {
      return r.return(204)
    }

    const user = cookieUser(r) ?? (await basicUser(r))
    if (user !== undefined) {
      r.headersOut["X-Forwarded-User"] = user
      return r.return(204)
    }

    const accept = (r.headersIn["Accept"] ?? "").toLowerCase()
    if (!accept.includes("html")) {
      r.headersOut["WWW-Authenticate"] = 'Basic realm="-"'
    }
    return r.return(401)
  },

  /** @param {NginxHTTPRequest} r */
  login: async (r) => {
    const origin = `${r.variables.scheme}://${r.variables.host}`
    const ref = r.headersIn["Referer"] ?? ""
    const requestOrigin = r.headersIn["Origin"]
    const sameOrigin = requestOrigin
      ? requestOrigin === origin
      : ref.startsWith(origin + "/")

    if (!sameOrigin) {
      return r.return(403)
    }

    const params = qs.parse(r.requestText ?? "")
    const username = removeWs(stringOrEmpty(params["username"]))

    const password = stringOrEmpty(params["password"])
    const creds = Buffer.from(`${username}:${password}`).toString("base64")
    if (!(await validate(r, creds))) {
      return r.return(401)
    }

    r.headersOut["Set-Cookie"] = [buildCookie(r, username)]

    const requested = stringOrEmpty(params["redirect"])
    const redirectPath = requested.startsWith(origin + "/")
      ? requested.slice(origin.length)
      : requested
    const redirect =
      LOCAL_PATH_RE.test(redirectPath) && !TAB_OR_NEWLINE_RE.test(redirectPath)
        ? redirectPath
        : "/"
    return r.return(303, redirect)
  },
}

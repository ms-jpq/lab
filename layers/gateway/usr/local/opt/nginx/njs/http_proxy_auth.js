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
const HMAC_SECRET =
  process.env["HTPASSWD_SECRET"] ||
  (() => {
    throw new Error()
  })()

const ALLOW_REX = (() => {
  /** @type {RegExp[]} */
  const acc = []

  const dir = "/var/lib/local/htpasswd"
  fs.readdirSync(dir).forEach((name) => {
    if (!name.endsWith(".txt")) {
      return
    }

    fs.readFileSync(`${dir}/${name}`, "utf8")
      .split("\n")
      .forEach((raw) => {
        const line = raw.trim()
        if (!line) {
          return
        }

        const pat = line
          .split("")
          .map((c, i) => {
            const hostname = !line.slice(0, i).includes("/")
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

        const re = new RegExp(`^${pat}${line.includes("/") ? "" : "/.*"}$`)
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
const firstString = (v) => (typeof v === "string" ? v : "")

/** @param {NginxHTTPRequest} o */
const isSecure = (o) => (o.variables.scheme ?? "").toLowerCase() !== "http"

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

/** @param {NginxHTTPRequest} o */
const hasValidAuthCookie = (o) => {
  const header = o.headersIn["Cookie"]
  if (!header) {
    return false
  }

  const name = cookieName(isSecure(o))
  return header.split(";").some((part) => {
    const nameValue = partition(part, "=")
    if (!nameValue || nameValue[0].trim() !== name) {
      return false
    }
    const plain = decodeCookieValue(cookieDomain(o), nameValue[1].trim())
    if (plain === undefined) {
      return false
    }
    const userExp = partition(plain, ":", true)
    if (!userExp) {
      return false
    }
    const exp = Number(userExp[1])
    return Number.isFinite(exp) && exp - Date.now() > 0
  })
}

/**
 * @param {NginxHTTPRequest} o
 * @param {string} user
 */
const buildCookie = (o, user) => {
  const domain = cookieDomain(o)
  const secure = isSecure(o)
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

/** @param {NginxHTTPRequest} o */
const parseAuth = (o) => {
  const header = o.headersIn["Authorization"]
  if (!header) {
    return undefined
  }

  const schemeCreds = partition(header, " ")
  if (!schemeCreds || schemeCreds[0].toLowerCase() !== "basic") {
    return undefined
  }
  const creds = schemeCreds[1].trim()

  const decoded = Buffer.from(creds, "base64").toString()
  const userPass = partition(decoded, ":")
  const user = removeWs(userPass ? userPass[0] : decoded)
  return { user, creds }
}

/**
 * @param {NginxHTTPRequest} r
 * @param {string} creds
 * @param {NginxHTTPRequest} o
 */
const validate = async (r, creds, o) => {
  const ip = o.remoteAddress ?? ""
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
    const o = r
    const uri =
      (o.variables.host ?? "") +
      (o.variables["htpasswd_request_uri"] ?? o.variables.uri ?? "/")

    if (matchAllow(uri) || hasValidAuthCookie(o)) {
      return r.return(204)
    }

    const parsed = parseAuth(o)
    if (parsed && (await validate(r, parsed.creds, o))) {
      return r.return(204)
    }

    const accept = (o.headersIn["Accept"] ?? "").toLowerCase()
    if (!accept.includes("html")) {
      r.headersOut["WWW-Authenticate"] = 'Basic realm="-"'
    }
    return r.return(401)
  },

  /** @param {NginxHTTPRequest} r */
  login: async (r) => {
    const o = r

    const want = `${o.variables.scheme}://${o.variables.host}`
    const ref = o.headersIn["Referer"] ?? ""
    const originHeader = o.headersIn["Origin"]

    if (originHeader ? originHeader !== want : !ref.startsWith(want + "/")) {
      return r.return(403)
    }

    const params = qs.parse(r.requestText ?? "")
    const username = removeWs(firstString(params["username"]))

    const password = firstString(params["password"])
    const creds = Buffer.from(`${username}:${password}`).toString("base64")
    if (!(await validate(r, creds, o))) {
      return r.return(401)
    }

    r.headersOut["Set-Cookie"] = [buildCookie(o, username)]

    const requested = firstString(params["redirect"])
    const redirectPath = requested.startsWith(want + "/")
      ? requested.slice(want.length)
      : requested
    const redirect =
      LOCAL_PATH_RE.test(redirectPath) && !TAB_OR_NEWLINE_RE.test(redirectPath)
        ? redirectPath
        : "/"
    return r.return(303, redirect)
  },
}

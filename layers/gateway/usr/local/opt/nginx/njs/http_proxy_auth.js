/// <reference path="../../../../../../../node_modules/njs-types/ngx_http_js_module.d.ts" />

import cr from "crypto"
import fs from "fs"
import qs from "querystring"

const ALGORITHM = "sha256"
const SUBREQ = "/-_-validate"
const COOKIE_NAME = "htpasswd"
const COOKIE_TTL = 60 * 60 * 24 * 7 * 2
const DOMAIN_PARTS = 2
const HMAC_SECRET =
  process.env.HTPASSWD_SECRET ||
  (() => {
    throw new Error()
  })()

const ALLOW_REX = (() => {
  const dir = "/var/lib/local/htpasswd"

  /** @type {RegExp[]} */
  const regex = []
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
          .map((c) => {
            switch (true) {
              case c === "*":
                return ".*"
              case c === "?":
                return "."
              case /[.+^${}()|[\]\\]/.test(c):
                return "\\" + c
              default:
                return c
            }
          })
          .join("")

        regex.push(new RegExp(`^${pat}$`))
      })
  })

  return regex
})()

/** @param {string} host_path */
const matchAllow = (host_path) => ALLOW_REX.some((re) => re.test(host_path))

/** @param {Buffer} plain */
const digest = (plain) =>
  Buffer.from(cr.createHmac(ALGORITHM, HMAC_SECRET).update(plain).digest())

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

/**
 * @param {NginxHTTPRequest} r
 * @returns {NginxHTTPRequest}
 */
const origin = (r) => (r.parent ? origin(r.parent) : r)

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

/** @param {string} data */
const encodeCookieValue = (data) => {
  const buf = Buffer.from(data)
  const sig = digest(buf).toString("base64")
  const plain = buf.toString("base64")
  return `${sig}.${plain}`
}

/** @param {string} value */
const decodeCookieValue = (value) => {
  const sigPlain = partition(value, ".")
  if (!sigPlain) {
    return undefined
  }
  const sig = Buffer.from(sigPlain[0], "base64")
  const plain = Buffer.from(sigPlain[1], "base64")
  return timingSafeEqual(sig, digest(plain)) ? plain.toString() : undefined
}

/** @param {NginxHTTPRequest} o */
const readAuthCookie = (o) => {
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
    const plain = decodeCookieValue(nameValue[1].trim())
    if (plain === undefined) {
      return false
    }
    const userExp = partition(plain, ":", true)
    if (!userExp) {
      return false
    }
    const exp = Number(userExp[1])
    return Number.isFinite(exp) && exp - Date.now() / 1000 >= 0
  })
}

/**
 * @param {NginxHTTPRequest} o
 * @param {string} user
 */
const buildCookie = (o, user) => {
  const host = o.variables.host ?? ""
  const secure = isSecure(o)
  const exp = Math.floor(Date.now() / 1000) + COOKIE_TTL

  const parts = [
    `${cookieName(secure)}=${encodeCookieValue(`${user}:${exp}`)}`,
    `Domain=${host.split(".").slice(-DOMAIN_PARTS).join(".")}`,
    `Expires=${new Date(exp * 1000).toUTCString()}`,
    `Max-Age=${COOKIE_TTL}`,
    "Path=/",
    "SameSite=Strict",
    "HttpOnly",
  ]
  if (secure) {
    parts.push("Secure")
  }

  return parts.join("; ")
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
  r.variables.htpasswd_authz = `Basic ${creds}`
  r.variables.htpasswd_ip = ip === "unix:" ? "::" : ip

  const reply = await r.subrequest(SUBREQ, { method: "GET" })
  return reply.status >= 200 && reply.status < 300
}

export default {
  /** @param {NginxHTTPRequest} r */
  gate: async (r) => {
    const o = origin(r)
    const uri =
      (o.variables.host ?? "") +
      (o.variables.uri ?? "/") +
      (o.variables.is_args ?? "") +
      (o.variables.args ?? "")

    if (matchAllow(uri) || readAuthCookie(o)) {
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
    const o = origin(r)

    const want = `${o.variables.scheme}://${o.variables.host}`
    const orig = o.headersIn["Origin"] ?? ""
    const ref = o.headersIn["Referer"] ?? ""
    if (orig !== want && !ref.startsWith(want + "/")) {
      return r.return(403)
    }

    const params = qs.parse(r.requestText ?? "")
    const username = removeWs(firstString(params.username))

    const password = firstString(params.password)
    const creds = Buffer.from(`${username}:${password}`).toString("base64")
    if (!(await validate(r, creds, o))) {
      return r.return(401)
    }

    r.headersOut["Set-Cookie"] = [buildCookie(o, username)]

    const redirect = removeWs(firstString(params.redirect)) || "/"
    r.headersOut["Location"] = redirect
    r.headersOut["X-Original-URL"] = redirect

    return r.return(303)
  },
}

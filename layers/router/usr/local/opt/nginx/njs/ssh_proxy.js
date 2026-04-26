/// <reference path="../../../../../../../node_modules/njs-types/ngx_stream_js_module.d.ts" />

const PREFIX = Buffer.from("SSH-")

/** @param {NginxStreamRequest} session */
const detect = (session) => {
  let len = 0
  const acc = Buffer.alloc(PREFIX.length)

  session.on("upstream", (data) => {
    len += data.copy(acc, len, 0, PREFIX.length - len)

    if (len >= PREFIX.length) {
      session.variables.x_ssh_detect = acc.equals(PREFIX) ? "ssh" : "ovpn"
      session.done()
    }
  })
}

export default { detect }

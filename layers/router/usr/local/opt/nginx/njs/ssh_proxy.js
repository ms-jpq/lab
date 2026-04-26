/// <reference path="../../../../../../../node_modules/njs-types/ngx_stream_js_module.d.ts" />

const PREFIX = Buffer.from("SSH-")
const EVENT = "upstream"

export default {
  /** @param {NginxStreamRequest} session */
  upstream: (session) => session.variables.x_ssh_detect,

  /** @param {NginxStreamRequest} session */
  detect: (session) => {
    let acc = Buffer.alloc(0)

    session.on(EVENT, (data, flags) => {
      acc = Buffer.concat([acc, data])

      if (flags.last || acc.length >= PREFIX.length) {
        session.off(EVENT)

        const isSsh = acc.subarray(0, PREFIX.length).equals(PREFIX)
        session.variables.x_ssh_detect = isSsh ? "ssh" : "ovpn"
        session.done()
      }
    })
  },
}

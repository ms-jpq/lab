/// <reference path="../../../../../../../node_modules/njs-types/ngx_stream_js_module.d.ts" />

const PREFIX = Buffer.from("SSH-")

export default {
  /** @param {NginxStreamRequest} session */
  detect: (session) => {
    let acc = Buffer.alloc(0)

    session.on("upstream", (data) => {
      acc = Buffer.concat([acc, data])

      if (acc.length >= PREFIX.length) {
        const isSsh = acc.subarray(0, PREFIX.length).equals(PREFIX)
        session.variables.x_ssh_detect = isSsh ? "ssh" : "ovpn"
        session.done()
      }
    })
  },
}

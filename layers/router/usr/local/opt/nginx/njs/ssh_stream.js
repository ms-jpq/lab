/// <reference path="../../../../../../../node_modules/njs-types/ngx_stream_js_module.d.ts" />

const event = "upstream";
const prefix = Buffer.from("SSH-");

/**
 * @param {NginxStreamRequest} session
 */
const ssh_detect = (session) => {
  let len = 0;
  /** @type {Buffer} */
  const acc = Buffer.alloc(prefix.length);
  session.on(event, (data, _) => {
    len += data.copy(acc, len, 0, prefix.length - len);
    if (len >= prefix.length) {
      const is_ssh = acc.equals(prefix);
      session.variables.x_ssh_detect = is_ssh ? "ssh" : "http";
      session.done();
    }
  });
};

export default { ssh_detect };

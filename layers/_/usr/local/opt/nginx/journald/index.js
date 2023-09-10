/**
 * @param {string} uri
 * @param {string | undefined}  cursor
 * @returns {AsyncIterableIterator<string>}
 */
const raw_stream = async function* (uri, cursor) {
  const coder = new TextDecoder();
  const headers = cursor ? { Range: `entries=${cursor}` } : undefined;
  const resp = await fetch(uri, {
    headers: { Accept: "application/json", ...headers },
  });
  const reader = resp.body?.getReader();
  while (true) {
    const { value, done } = (await reader?.read()) ?? {};
    if (done || !value) {
      break;
    }
    yield coder.decode(value, { stream: true });
  }
  yield coder.decode();
};

/**
 * @param {symbol} sym
 * @param {string} uri
 * @returns {AsyncIterableIterator<Record<string, string>>}
 */
const stream = async function* (sym, uri) {
  /** @type string[] */
  const acc = [];
  let timeout = 60;
  let cursor = undefined;
  while (true) {
    try {
      for await (const tokens of raw_stream(uri, cursor)) {
        for (const token of tokens) {
          if (token === "\n") {
            const json = JSON.parse(acc.join(""));
            cursor = json.__CURSOR;
            yield json;
            acc.length = 0;
            timeout = 60;
          } else {
            acc.push(token);
          }
        }
      }
    } catch (err) {
      yield { [sym]: err };
      acc.length = 0;
    } finally {
      await new Promise((resolve) => setTimeout(resolve, timeout));
      timeout = timeout * 1.6;
    }
  }
};

const append = ((handle) => {
  /**
   * @param {symbol} sym
   * @param {HTMLElement} root
   * @param {Record<string, string>} json
   */
  return (sym, root, json) => {
    const {
      [sym]: err,
      __REALTIME_TIMESTAMP,
      MESSAGE,
      SYSLOG_IDENTIFIER,
    } = json;

    const ts = __REALTIME_TIMESTAMP
      ? new Date(Number(__REALTIME_TIMESTAMP) / 1000)
      : new Date();
    const li = document.createElement("li");

    const tt =
      ts.getFullYear().toString().slice(2) +
      "/" +
      (ts.getMonth() + 1).toString().padStart(2, 0) +
      "/" +
      ts.getDate().toString().padStart(2, 0) +
      " " +
      ts.getHours().toString().padStart(2, 0) +
      ":" +
      ts.getMinutes().toString().padStart(2, 0) +
      ":" +
      ts.getSeconds().toString().padStart(2, 0);
    const time = document.createElement("time");
    time.setAttribute("datetime", ts.toISOString());
    time.appendChild(document.createTextNode(tt));

    const id = document.createTextNode(SYSLOG_IDENTIFIER);
    const msg = document.createTextNode(err ?? MESSAGE);
    const line = err
      ? (() => {
          const em = document.createElement("em");
          em.appendChild(msg);
          return em;
        })()
      : msg;

    li.appendChild(time);
    li.appendChild(id);
    li.appendChild(line);
    root.appendChild(li);

    clearTimeout(handle);
    handle = setTimeout(() => {
      const { scrollTop, clientHeight, scrollHeight } = root;
      const eof = Math.abs(scrollTop + clientHeight - scrollHeight) < 1;
      if (eof) {
        root.scrollIntoView({ block: "end" });
      }
    });
  };
})(NaN);

(async () => {
  const uri =
    (globalThis.location?.origin ?? "localhost") + "/entries?boot&follow";

  const sym = Symbol();
  const root = globalThis?.document?.querySelector("ol");

  for await (const json of stream(sym, uri)) {
    if (!root) {
      console.log(json);
    } else {
      append(sym, root, json);
    }
  }
})();

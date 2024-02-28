globalThis.requestIdleCallback ??= (cb) => setTimeout(cb);
globalThis.cancelIdleCallback ??= clearTimeout;

const origin = globalThis.location?.origin ?? "http://localhost:8080";

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

const init_cursor = async () => {
  while (true) {
    try {
      const resp = await fetch(origin + "/journal-cursor.sh/");
      return await resp.text();
    } catch (e) {
      await new Promise((resolve) => setTimeout(resolve, 188));
      console.error(e);
    }
  }
};

const stream = (() => {
  const t = 60;
  /**
   * @param {symbol} sym
   * @param {string} uri
   * @returns {AsyncIterableIterator<Record<string, string>>}
   */
  return async function* (sym, uri) {
    /** @type {string[]} */
    const acc = [];
    let timeout = t;
    let cursor = await init_cursor();
    while (true) {
      try {
        for await (const tokens of raw_stream(uri, cursor)) {
          for (const token of tokens) {
            if (token === "\n") {
              const json = JSON.parse(acc.join(""));
              cursor = json.__CURSOR;
              yield json;
              acc.length = 0;
              timeout = t;
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
})();

const debounce = ((handle) => {
  /**
   * @param {() => void} exec
   */
  return (exec) => {
    cancelIdleCallback(handle);
    handle = requestIdleCallback(exec);
  };
})(NaN);

/**
 * @param {symbol} sym
 * @param {HTMLElement} root
 * @param {Record<string, string>} json
 */
const append = (sym, root, json) => {
  const s = /** @type {string} */ (/** @type {unknown} */ (sym));
  const {
    [s]: err,
    CONTAINER_NAME,
    MESSAGE,
    SYSLOG_IDENTIFIER,
    _HOSTNAME,
    _KERNEL_SUBSYSTEM,
    _SYSTEMD_UNIT,
    __REALTIME_TIMESTAMP,
  } = json;

  const ts = __REALTIME_TIMESTAMP
    ? new Date(Number(__REALTIME_TIMESTAMP) / 1000)
    : new Date();
  const li = document.createElement("li");

  const tt =
    ts.getFullYear().toString().slice(2) +
    "/" +
    (ts.getMonth() + 1).toString().padStart(2, "0") +
    "/" +
    ts.getDate().toString().padStart(2, "0") +
    " " +
    ts.getHours().toString().padStart(2, "0") +
    ":" +
    ts.getMinutes().toString().padStart(2, "0") +
    ":" +
    ts.getSeconds().toString().padStart(2, "0");
  const time = document.createElement("time");
  time.setAttribute("datetime", ts.toISOString());
  time.appendChild(document.createTextNode(tt));

  const id = document.createTextNode(
    err?.constructor?.toString() ??
      [
        ...(function* () {
          if (_HOSTNAME) {
            yield `@${_HOSTNAME}`;
          }
          if (_KERNEL_SUBSYSTEM) {
            yield `*${_KERNEL_SUBSYSTEM}*`;
          }
          if (_SYSTEMD_UNIT) {
            yield `[${_SYSTEMD_UNIT}]`;
          }
        })(),
      ].join(" "),
  );
  const b = document.createElement("b");
  b.appendChild(id);

  const ie = document.createTextNode(
    [
      ...(function* () {
        if (CONTAINER_NAME) {
          yield CONTAINER_NAME;
        } else if (SYSLOG_IDENTIFIER) {
          yield SYSLOG_IDENTIFIER;
        }
      })(),
    ].join(" "),
  );
  const i = document.createElement("i");
  i.appendChild(ie);

  const msg = document.createTextNode(err ?? MESSAGE ?? "");
  const line = err
    ? (() => {
        const em = document.createElement("em");
        em.appendChild(msg);
        return em;
      })()
    : msg;

  const label = document.createElement("label");
  label.appendChild(b);
  label.appendChild(i);
  label.appendChild(line);

  li.appendChild(time);
  li.appendChild(label);
  root.appendChild(li);

  debounce(() => {
    const eof = document.querySelector("input")?.checked;
    if (eof) {
      li.scrollIntoView({ block: "end" });
    }
  });
};

(async () => {
  const uri = (() => {
    const params = new URLSearchParams(globalThis.location?.search ?? "");
    return origin + `/entries?follow&${params}`;
  })();

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

globalThis.requestIdleCallback ??= (cb) => setTimeout(cb);
globalThis.cancelIdleCallback ??= clearTimeout;

const CURSOR = "cursor";

const origin = globalThis.location?.origin ?? "http://localhost:8080";
const params = new URLSearchParams(globalThis.location?.search);
const COUNT = 999;

/**
 * @param {string} uri
 * @param {string | undefined}  cursor
 * @returns {AsyncIterableIterator<string>}
 */
const raw_stream = async function* (uri, cursor) {
  const abortion = new AbortController();
  const headers = cursor ? { Range: `entries=${cursor}` } : undefined;
  const resp = await fetch(uri, {
    headers: { Accept: "application/json", ...headers },
    signal: abortion.signal,
  });
  const stream = resp.body?.pipeThrough(new TextDecoderStream());
  const reader = stream?.getReader();
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done || !value) {
          break;
        }
        yield value;
      }
    }
  } finally {
    abortion.abort();
    console.info(".");
  }
};

const init_cursor = async () => {
  if (params.size) {
    return globalThis?.localStorage.getItem(CURSOR) ?? undefined;
  }
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

const parse_ansi = (() => {
  const ansiPattern =
    "[\\u001B\\u009B][[\\]()#;?]*" +
    "(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*" +
    "|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)" +
    "|(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))";
  const ansi = new RegExp(ansiPattern, "ug");

  /**
   * @param {number[]} codes
   */
  return (codes) => {
    try {
      const str = String.fromCharCode(...codes);
      return str.replace(ansi, "");
    } catch {
      return "";
    }
  };
})();

const stream = (() => {
  const t = 60;
  /** @type {string[]} */
  const acc = [];
  let timeout = t;

  /**
   * @param {symbol} sym
   * @param {string} uri
   * @returns {AsyncIterableIterator<Record<string, string>>}
   */
  return async function* (sym, uri) {
    let cursor = await init_cursor();
    if (cursor) {
      yield { [sym]: cursor };
    }
    console.info({ cursor });
    while (true) {
      const t0 = performance.now();
      try {
        loop: for await (const tokens of raw_stream(uri, cursor)) {
          for (const token of tokens) {
            if (token === "\n") {
              const json = JSON.parse(acc.join(""));
              for (const [key, value] of Object.entries(json)) {
                if (Array.isArray(value)) {
                  json[key] = parse_ansi(value);
                }
              }
              yield json;
              const c = json.__CURSOR;
              acc.length = 0;
              timeout = t;
              if (c) {
                cursor = c;
                if (params.size) {
                  globalThis?.localStorage.setItem(CURSOR, c);
                }
              }
              if (performance.now() - t0 > 60 * 1000) {
                break loop;
              }
            } else {
              acc.push(token);
            }
          }
        }
      } catch (err) {
        yield { [sym]: err };
        await new Promise((resolve) => setTimeout(resolve, timeout));
        timeout = timeout * 1.6;
      } finally {
        acc.length = 0;
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
  const li =
    (root.childElementCount >= COUNT ? root.firstElementChild : undefined) ??
    document.createElement("li");
  li.replaceChildren();

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
    err?.constructor?.name ??
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
        } else if (SYSLOG_IDENTIFIER && SYSLOG_IDENTIFIER !== _SYSTEMD_UNIT) {
          yield SYSLOG_IDENTIFIER;
        }
      })(),
    ].join(" "),
  );
  const i = document.createElement("i");
  const b2 = document.createElement("b");
  b2.appendChild(ie);
  i.appendChild(b2);

  const message = document.createTextNode(err ?? MESSAGE ?? "");
  const msg = document.createElement("span");
  msg.appendChild(message);
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
  const uri = origin + `/entries?follow&${params}`;
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

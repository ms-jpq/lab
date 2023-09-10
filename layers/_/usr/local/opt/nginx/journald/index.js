globalThis.requestIdleCallback ??= (cb) => setTimeout(cb);
globalThis.cancelIdleCallback ??= clearTimeout;

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

const debounce = ((handle) => {
  /**
   * @param {() => void} exec
   */
  return (exec) => {
    cancelIdleCallback(handle);
    handle = requestIdleCallback(exec);
  };
})(NaN);

const append = (() => {
  let anchor = undefined;
  let intersecting = true;
  const obs = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      intersecting = entry.isIntersecting;
    }
  }, {});

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
    const b = document.createElement("b");
    b.appendChild(id);

    const msg = document.createTextNode(err ?? MESSAGE);
    const line = err
      ? (() => {
          const em = document.createElement("em");
          em.appendChild(msg);
          return em;
        })()
      : msg;

    const label = document.createElement("label");
    label.appendChild(b);
    label.appendChild(line);

    li.appendChild(time);
    li.appendChild(label);
    root.appendChild(li);

    if (anchor) {
      obs.unobserve(anchor);
    }
    anchor = li;
    obs.observe(anchor);

    debounce(() => {
      if (intersecting) {
        root.scrollIntoView({ block: "end" });
        intersecting = true;
      }
    });
  };
})();

(async () => {
  const uri =
    (globalThis.location?.origin ?? "localhost") + "/entries?boot&follow";

  const sym = Symbol();
  const root = globalThis?.document?.querySelector("ol");

  globalThis?.document
    ?.querySelector("button")
    ?.addEventListener("click", () => root.scrollIntoView({ block: "end" }));

  for await (const json of stream(sym, uri)) {
    if (!root) {
      console.log(json);
    } else {
      append(sym, root, json);
    }
  }
})();

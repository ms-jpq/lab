import { equal } from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const exec = promisify(execFile)
const { execPath } = process as unknown as NodeJS.Process

const startup = `
import { deepEqual, equal, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import { readFile } from "node:fs/promises"
import { setImmediate } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import vm from "node:vm"
import { EventTarget } from ${JSON.stringify(new URL("./fixtures/event_target.ts", import.meta.url).href)}

const [directory, symbols] = process.argv.slice(1)
const window = new EventTarget()
const requests = []
const errors = []
const sources = []
const revoked = []
const empty = { length: 0 }
const media = Object.assign(new EventTarget(), {
  dataset: { duration: "200", mseType: "video/mp4", src: "/media" },
  HAVE_METADATA: 1,
  buffered: empty,
  currentTime: 0,
  error: null,
  paused: true,
  readyState: 0,
  seeking: false,
  load() {},
  pause() { this.paused = true },
  removeAttribute(name) { if (name === "src") this.src = "" },
})
let src = ""
Object.defineProperty(media, "src", {
  get: () => src,
  set(value) {
    src = value
    if (value) queueMicrotask(() => {
      const source = sources.at(-1)
      source.readyState = "open"
      source.dispatchEvent(new Event("sourceopen"))
    })
  },
})
class MediaSource extends EventTarget {
  readyState = "closed"
  duration = Number.NaN
  constructor() { super(); sources.push(this) }
  addSourceBuffer() {
    return Object.assign(new EventTarget(), {
      buffered: empty, updating: false, timestampOffset: 0,
    })
  }
}
class PlayerURL extends URL {
  static createObjectURL() { return "blob:player-module-test" }
  static revokeObjectURL(value) { revoked.push(value) }
}
const form = { elements: { namedItem: () => ({ value: "0" }) } }
const context = vm.createContext({
  AbortController, AbortSignal, DOMException, Event, EventTarget,
  MediaSource, Promise, ReadableStream, Request, URL: PlayerURL, URLSearchParams,
  clearTimeout, crypto, queueMicrotask, setTimeout, window,
  console: { error: (...values) => errors.push(values) },
  document: { querySelector: (selector) =>
    selector === "video, audio" ? media : selector === "#subtitle" ? null : form },
  localStorage: { getItem: () => null },
  location: { href: "https://example.test/player", pathname: "/player" },
  fetch: async (request) => {
    requests.push(request)
    return new Response(new ReadableStream())
  },
})
if (symbols === "missing") {
  vm.runInContext(
    "const native = Symbol; globalThis.Symbol = Object.assign(" +
    "(description) => native(description), { for: native.for, " +
    "iterator: native.iterator, asyncIterator: native.asyncIterator })",
    context,
  )
}
const modules = new Map()
const link = async (specifier, parent) => {
  ok(/^\\.\\/[^/]+\\.js$/.test(specifier), "emitted imports must use relative JS basenames")
  const url = new URL(specifier, parent.identifier)
  if (!modules.has(url.href)) {
    modules.set(url.href, (async () =>
      new vm.SourceTextModule(await readFile(url, "utf8"), {
        context, identifier: url.href,
      })
    )())
  }
  return modules.get(url.href)
}
const entry = await link("./index.js", {
  identifier: pathToFileURL(directory + "/").href,
})
await entry.link(link)
await entry.evaluate()
equal(typeof form.onsubmit, "function", "index must invoke main without fixture assistance")
equal(getEventListeners(window, "pageshow").length, 1)
equal(vm.runInContext("typeof Symbol.dispose", context), "symbol")
equal(vm.runInContext("typeof Symbol.asyncDispose", context), "symbol")

try {
  window.dispatchEvent(new Event("pageshow"))
  for (let turn = 0; turn < 100 && requests.length === 0; turn++) await setImmediate()
  equal(requests.length, 1)
  equal(sources.length, 1)
  equal(new URL(requests[0].url).searchParams.get("t"), "0")
  deepEqual(errors, [])
} finally {
  globalThis.gc()
  window.dispatchEvent(new Event("pagehide"))
  for (let turn = 0; turn < 100 && media.src !== ""; turn++) await setImmediate()
}
equal(media.src, "")
equal(requests[0]?.signal.aborted, true)
deepEqual(revoked, ["blob:player-module-test"])
equal(getEventListeners(media, "timeupdate").length, 0)
deepEqual(errors, [])
console.log("startup and teardown passed")
`

test(
  "emitted ES modules start and dispose with native or polyfilled disposal symbols",
  { timeout: 30_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "player-modules-"))
    try {
      await exec(
        execPath,
        [
          fileURLToPath(
            new URL("../bin/tsc", import.meta.resolve("typescript")),
          ),
          "--project",
          fileURLToPath(new URL("tsconfig.json", import.meta.url)),
          "--outDir",
          directory,
          "--rootDir",
          fileURLToPath(new URL(".", import.meta.url)),
          "--incremental",
          "false",
        ],
        { timeout: 20_000 },
      )

      await Promise.all(
        ["native", "missing"].map(async (symbols) => {
          const { stdout } = await exec(
            execPath,
            [
              "--expose-gc",
              "--experimental-vm-modules",
              "--input-type=module",
              "--eval",
              startup,
              directory,
              symbols,
            ],
            { timeout: 10_000 },
          )
          equal(stdout.trim(), "startup and teardown passed")
        }),
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

import { equal, ok } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import { setImmediate } from "node:timers/promises"
import vm from "node:vm"

type Playback = (signal: AbortSignal) => Promise<void>

const subtitle_fixture = () => {
  const cancelled: (() => void)[] = []
  const requests: string[] = []
  const subtitle = Object.assign(new EventTarget(), {
    dataset: { src: "/subtitle" },
    readyState: 0,
    LOADING: 1,
    LOADED: 2,
    ERROR: 3,
  })
  const finish = (type: "load" | "error") => {
    subtitle.readyState = type === "load" ? subtitle.LOADED : subtitle.ERROR
    subtitle.dispatchEvent(new Event(type))
  }
  Object.defineProperty(subtitle, "src", {
    get: () => requests.at(-1) ?? "",
    set: (value: string) => {
      if (
        subtitle.readyState === subtitle.LOADING &&
        value !== requests.at(-1)
      ) {
        // HTML queues an error when changing the URL of a loading text track.
        // https://html.spec.whatwg.org/multipage/media.html#sourcing-out-of-band-text-tracks
        cancelled.push(() => finish("error"))
      }
      requests.push(value)
      subtitle.readyState = subtitle.LOADING
    },
  })
  return { cancelled, finish, requests, subtitle }
}

const fixture = async (
  subtitle: EventTarget | null = null,
  timers?: Map<number, () => void>,
) => {
  const window = new EventTarget()
  const media = {
    dataset: { duration: "200", mseType: "video/mp4", src: "/media" },
    src: "",
    removeAttribute: (name: string) => {
      if (name === "src") {
        media.src = ""
      }
    },
  }
  const form = {
    elements: { namedItem: () => ({ value: "0" }) },
    onsubmit: undefined,
  }
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    clearTimeout: timers ? (id: number) => timers.delete(id) : clearTimeout,
    console: { error: () => undefined },
    crypto,
    document: {
      querySelector: (selector: string) =>
        selector === "video, audio"
          ? media
          : selector === "#subtitle"
            ? subtitle
            : form,
    },
    localStorage: { getItem: () => null },
    location: { href: "https://example.test/player", pathname: "/player" },
    Promise,
    setTimeout: timers
      ? (callback: () => void) => {
          const id = timers.size + 1
          timers.set(id, callback)
          return id
        }
      : setTimeout,
    URL,
    window,
  })
  const source = (
    await Promise.all(
      ["util.ts", "media.ts", "page.ts"].map((name) =>
        readFile(new URL(name, import.meta.url), "utf8"),
      ),
    )
  )
    .join("\n")
    .replace(/^import .*$/gmu, "")
    .replace(/^export /gmu, "")

  const main = vm.runInContext(
    stripTypeScriptTypes(`${source}\nmain`, { mode: "strip" }),
    context,
  ) as (playback: Playback) => Promise<void>
  return { main, media, window }
}

test("page restoration does not let previous playback cleanup detach the new source", async () => {
  const { main, media, window } = await fixture()
  const cleanup = Promise.withResolvers<void>()
  const started: AbortSignal[] = []
  const finished: number[] = []
  const failures: unknown[] = []

  void main(async (signal) => {
    started.push(signal)
    const session = started.length
    media.src = `source:${session}`
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    if (session === 1) {
      await cleanup.promise
    }
    media.removeAttribute("src")
    finished.push(session)
  }).catch((error: unknown) => failures.push(error))

  try {
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(started.length, 1)

    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
    ok(started[0]?.aborted)

    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(started.length, 1)
    cleanup.resolve()
    await setImmediate()

    equal(failures.length, 0)
    ok(finished.includes(1))
    equal(media.src, "source:2")
  } finally {
    cleanup.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
  }
})

test("a restored page hidden again during cleanup does not start playback", async () => {
  const { main, window } = await fixture()
  const cleanup = Promise.withResolvers<void>()
  const started: AbortSignal[] = []
  const failures: unknown[] = []
  void main(async (signal) => {
    started.push(signal)
    const session = started.length
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    if (session === 1) {
      await cleanup.promise
    }
  }).catch((error: unknown) => failures.push(error))

  try {
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(started.length, 1)
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
    ok(started[0]?.aborted)

    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    window.dispatchEvent(new Event("pagehide"))
    cleanup.resolve()
    await setImmediate()
    equal(started.length, 1)

    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(started.length, 2)
    equal(failures.length, 0)
  } finally {
    cleanup.resolve()
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
  }
})

test("playback teardown failures escape the page lifetime", async () => {
  const { main, window } = await fixture()
  const failure = new Error("playback cleanup failed")
  const started: AbortSignal[] = []
  const finished = main(async (signal) => {
    started.push(signal)
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
    throw failure
  }).catch((error: unknown) => error)

  window.dispatchEvent(new Event("pageshow"))
  await setImmediate()
  equal(started.length, 1)
  window.dispatchEvent(new Event("pagehide"))
  equal(await finished, failure)

  window.dispatchEvent(new Event("pageshow"))
  await setImmediate()
  equal(started.length, 1)
})

test("restoring a loading subtitle does not turn cancellation into a retry loop", async () => {
  const timers = new Map<number, () => void>()
  const { cancelled, finish, requests, subtitle } = subtitle_fixture()
  const { main, window } = await fixture(subtitle, timers)
  const started: AbortSignal[] = []
  const failures: unknown[] = []
  void main(async (signal) => {
    started.push(signal)
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
  }).catch((error: unknown) => failures.push(error))

  try {
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(requests.length, 1)
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(started.length, 2)

    for (let retry = 0; retry < 3; retry++) {
      for (const notify of cancelled.splice(0)) {
        notify()
      }
      await setImmediate()
      const scheduled = [...timers.values()]
      timers.clear()
      for (const fire of scheduled) {
        fire()
      }
      await setImmediate()
    }

    equal(failures.length, 0)
    equal(requests.length, 1)
    finish("load")
    await setImmediate()
    equal(timers.size, 0)
    equal(started.at(-1)?.aborted, false)
  } finally {
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
  }
})

for (const outcome of ["load", "error"] as const) {
  test(`restoring a subtitle after ${outcome} while hidden respects its ready state`, async () => {
    const { requests, subtitle, finish } = subtitle_fixture()
    const { main, window } = await fixture(subtitle)
    const started: AbortSignal[] = []
    const failures: unknown[] = []
    void main(async (signal) => {
      started.push(signal)
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
    }).catch((error: unknown) => failures.push(error))

    try {
      window.dispatchEvent(new Event("pageshow"))
      await setImmediate()
      equal(requests.length, 1)
      window.dispatchEvent(new Event("pagehide"))
      await setImmediate()
      finish(outcome)
      window.dispatchEvent(new Event("pageshow"))
      await setImmediate()
      equal(started.length, 2)
      equal(started.at(-1)?.aborted, false)
      equal(requests.length, outcome === "load" ? 1 : 2)
      equal(failures.length, 0)
    } finally {
      window.dispatchEvent(new Event("pagehide"))
      await setImmediate()
    }
  })
}

test("a restored pending subtitle still retries its own loading failure", async () => {
  const timers = new Map<number, () => void>()
  const { cancelled, requests, subtitle, finish } = subtitle_fixture()
  const { main, window } = await fixture(subtitle, timers)
  const started: AbortSignal[] = []
  const failures: unknown[] = []
  void main(async (signal) => {
    started.push(signal)
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true })
    })
  }).catch((error: unknown) => failures.push(error))

  try {
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
    window.dispatchEvent(new Event("pageshow"))
    await setImmediate()
    equal(requests.length, 1)

    finish("error")
    await setImmediate()
    equal(timers.size, 1)
    const scheduled = [...timers.values()]
    timers.clear()
    for (const fire of scheduled) {
      fire()
    }
    await setImmediate()
    equal(requests.length, 2)
    equal(cancelled.length, 0)
    finish("load")
    await setImmediate()
    equal(timers.size, 0)
    equal(started.at(-1)?.aborted, false)
    equal(failures.length, 0)
  } finally {
    window.dispatchEvent(new Event("pagehide"))
    await setImmediate()
  }
})

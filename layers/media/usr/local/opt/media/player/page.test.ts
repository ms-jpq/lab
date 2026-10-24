import { deepEqual, doesNotThrow, equal, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import { setImmediate } from "node:timers/promises"
import vm from "node:vm"
import { EventTarget, player_script, run_cases } from "./test_utils.ts"

type Playback = (signal: AbortSignal) => Promise<void>

const wait_for_abort = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true })
  })

const script = await player_script(
  ["util.ts", "media.ts", "subtitle.ts", "page.ts"],
  "({ main, persist_position, play_subtitle })",
)

const subtitle_fixture = () => {
  const cancelled: (() => void)[] = []
  const requests: string[] = []
  const subtitle = Object.assign(new EventTarget(), {
    dataset: { src: "/subtitle" },
    readyState: 0,
    LOADING: 1,
    LOADED: 2,
    ERROR: 3,
    track: { mode: "showing" },
    removeAttribute: (name: string) => {
      if (name === "src") {
        source = ""
        subtitle.readyState = 0
      }
    },
  })
  let source = ""
  const finish = (type: "load" | "error") => {
    subtitle.readyState = type === "load" ? subtitle.LOADED : subtitle.ERROR
    subtitle.dispatchEvent(new Event(type))
  }
  Object.defineProperty(subtitle, "src", {
    get: () => source,
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
      source = value
      subtitle.readyState = subtitle.LOADING
    },
  })
  return { cancelled, finish, requests, subtitle }
}

const fixture = async (
  subtitle: EventTarget | readonly EventTarget[] | null = null,
  timers?: Map<number, () => void>,
) => {
  const window = new EventTarget()
  const fetched: { url: string; signal: AbortSignal }[] = []
  const revoked: string[] = []
  const blobs: Blob[] = []
  class ObjectURL extends URL {
    static override createObjectURL(blob: Blob): string {
      blobs.push(blob)
      return `blob:subtitle:${blobs.length}`
    }
    static override revokeObjectURL(url: string): void {
      revoked.push(url)
    }
  }
  const media = {
    textTracks: new EventTarget(),
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
    Blob,
    fetch: async (url: string | URL, options: { signal: AbortSignal }) => {
      fetched.push({ url: String(url), signal: options.signal })
      return new Response("WEBVTT\n\n", {
        headers: { "Content-Type": "text/vtt" },
      })
    },
    clearTimeout: timers ? (id: number) => timers.delete(id) : clearTimeout,
    console: { error: () => undefined },
    crypto,
    document: {
      querySelectorAll: () =>
        subtitle === null
          ? []
          : Array.isArray(subtitle)
            ? subtitle
            : [subtitle],
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
    URL: ObjectURL,
    window,
  })
  const { main, persist_position, play_subtitle } = script.runInContext(
    context,
  ) as {
    main: (playback: Playback) => Promise<void>
    persist_position: (position: number) => void
    play_subtitle: (
      track: EventTarget,
      options: { signal: AbortSignal; tracks: EventTarget },
    ) => Promise<void>
  }
  return {
    blobs,
    context,
    fetched,
    main,
    media,
    persist_position,
    play_subtitle: (track: EventTarget, signal: AbortSignal) =>
      play_subtitle(track, { signal, tracks: media.textTracks }),
    revoked,
    window,
  }
}

const cases = [
  {
    name: "loaded subtitles remain attached until their owner aborts",
    run: async (): Promise<void> => {
      const track = subtitle_fixture()
      const { play_subtitle, revoked } = await fixture(track.subtitle)
      const owner = new AbortController()
      const loaded = play_subtitle(track.subtitle, owner.signal)
      await setImmediate()
      track.finish("load")
      equal(
        await Promise.race([
          loaded.then(() => "loaded"),
          setImmediate("pending"),
        ]),
        "pending",
      )
      equal(owner.signal.aborted, false)
      equal(Reflect.get(track.subtitle, "src"), track.requests[0])
      deepEqual(revoked, [])
      owner.abort()
      await loaded
      equal(getEventListeners(owner.signal, "abort").length, 0)
      equal(Reflect.get(track.subtitle, "src"), "")
      deepEqual(revoked, track.requests)
    },
  },
  ...["network", "http"].map((failure) => ({
    name: `subtitle ${failure} failures retry without attaching a native source`,
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const track = subtitle_fixture()
      const { context, main, window } = await fixture(track.subtitle, timers)
      const urls: string[] = []
      context["fetch"] = async (url: string | URL) => {
        urls.push(String(url))
        if (urls.length === 1) {
          if (failure === "network") {
            throw new Error("subtitle request failed")
          }
          return new Response("unavailable", { status: 503 })
        }
        return new Response("WEBVTT\n\n")
      }
      const failures: unknown[] = []
      void main(wait_for_abort).catch((error: unknown) => failures.push(error))
      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(track.requests.length, 0)
        equal(timers.size, 1)
        const callbacks = [...timers.values()]
        timers.clear()
        for (const callback of callbacks) {
          callback()
        }
        await setImmediate()
        equal(track.requests.length, 1)
        equal(urls.length, 2)
        ok(new URL(urls[0]!).searchParams.get("request"))
        ok(urls[0] !== urls[1])
        track.finish("load")
        await setImmediate()
        equal(timers.size, 0)
        deepEqual(failures, [])
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  })),
  {
    name: "a subtitle body completing after cancellation cannot attach a source",
    run: async (): Promise<void> => {
      const track = subtitle_fixture()
      const { context, main, window, blobs, revoked } = await fixture(
        track.subtitle,
      )
      const body = Promise.withResolvers<Blob>()
      const requests: AbortSignal[] = []
      context["fetch"] = async (
        _: string,
        options: { signal: AbortSignal },
      ) => {
        requests.push(options.signal)
        return { ok: true, blob: () => body.promise }
      }
      const failures: unknown[] = []
      void main(wait_for_abort).catch((error: unknown) => failures.push(error))
      window.dispatchEvent(new Event("pageshow"))
      await setImmediate()
      equal(requests.length, 1)
      window.dispatchEvent(new Event("pagehide"))
      await setImmediate()
      equal(requests[0]?.aborted, true)
      body.resolve(new Blob(["WEBVTT\n\n"]))
      await setImmediate()
      equal(track.requests.length, 0)
      equal(blobs.length, 0)
      deepEqual(revoked, [])
      deepEqual(failures, [])
    },
  },
  {
    name: "loaded subtitle URLs remain owned until pagehide and are renewed on restoration",
    run: async (): Promise<void> => {
      const track = subtitle_fixture()
      const { main, window, revoked, fetched } = await fixture(track.subtitle)
      const failures: unknown[] = []
      void main(wait_for_abort).catch((error: unknown) => failures.push(error))
      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        const initial = track.requests[0]!
        track.finish("load")
        await setImmediate()
        deepEqual(revoked, [])
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
        deepEqual(revoked, [initial])
        equal(Reflect.get(track.subtitle, "src"), "")
        equal(track.subtitle.track.mode, "showing")
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(fetched.length, 2)
        equal(track.requests.length, 2)
        ok(track.requests[1] !== initial)
        track.finish("load")
        await setImmediate()
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
      deepEqual(revoked, track.requests)
      deepEqual(failures, [])
    },
  },
  {
    name: "DOM readiness starts playback before subtitles finish and delayed pageshow does not duplicate it",
    run: async (): Promise<void> => {
      const track = subtitle_fixture()
      const { main, window } = await fixture(track.subtitle)
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
      }).catch((error: unknown) => failures.push(error))

      try {
        window.dispatchEvent(new Event("DOMContentLoaded"))
        await setImmediate()
        equal(track.subtitle.readyState, track.subtitle.LOADING)
        equal(started.length, 1)
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
        equal(started[0]?.aborted, true)
        equal(started.length, 1)
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 2)
        equal(track.requests.length, 2)
        deepEqual(failures, [])
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  },
  {
    name: "a pending subtitle fetch never attaches an incomplete native track",
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const track = subtitle_fixture()
      const { context, main, window, blobs } = await fixture(
        track.subtitle,
        timers,
      )
      const body = Promise.withResolvers<Blob>()
      context["fetch"] = async () => ({ ok: true, blob: () => body.promise })
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
      }).catch((error: unknown) => failures.push(error))

      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
        equal(track.subtitle.readyState, 0)
        equal(track.requests.length, 0)
        equal(blobs.length, 0)
        equal(timers.size, 0)
        equal(started[0]?.aborted, false)

        body.resolve(new Blob(["WEBVTT\n\n"]))
        await setImmediate()
        equal(track.requests.length, 1)
        equal(blobs.length, 1)
        track.finish("load")
        await setImmediate()
        equal(started[0]?.aborted, false)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
      equal(timers.size, 0)
      equal(getEventListeners(track.subtitle, "load").length, 0)
      equal(getEventListeners(track.subtitle, "error").length, 0)
      deepEqual(failures, [])
    },
  },
  {
    name: "characterization: bootstrap after pageshow waits for another pageshow even when the document is complete",
    run: async (): Promise<void> => {
      const { context, main, window } = await fixture()
      context["document"].readyState = "complete"
      window.dispatchEvent(new Event("pageshow"))
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
      }).catch((error: unknown) => failures.push(error))

      try {
        await setImmediate()
        equal(started.length, 0)
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
      equal(started[0]?.aborted, true)
      deepEqual(failures, [])
    },
  },
  {
    name: "native subtitle tracks retry independently without fetching an unselected track",
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const first = subtitle_fixture()
      const second = subtitle_fixture()
      second.subtitle.track.mode = "disabled"
      const { main, media, fetched, revoked, window } = await fixture(
        [first.subtitle, second.subtitle],
        timers,
      )
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
      }).catch((error: unknown) => failures.push(error))

      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(first.requests.length, 1)
        equal(second.requests.length, 0)
        equal(second.subtitle.readyState, 0)
        first.finish("load")
        await setImmediate()
        equal(started[0]?.aborted, false)

        second.subtitle.track.mode = "hidden"
        media.textTracks.dispatchEvent(new Event("change"))
        await setImmediate()
        equal(second.requests.length, 1)
        second.finish("error")
        await setImmediate()
        equal(timers.size, 1)
        deepEqual(revoked, [second.requests[0]])
        equal(Reflect.get(second.subtitle, "src"), "")
        const scheduled = [...timers.values()]
        timers.clear()
        for (const fire of scheduled) {
          fire()
        }
        await setImmediate()
        equal(first.requests.length, 1)
        equal(second.requests.length, 2)
        const retried = new URL(fetched[2]!.url)
        equal(retried.pathname, "/subtitle")
        ok(retried.searchParams.has("request"))
        second.finish("load")
        await setImmediate()
        equal(second.subtitle.track.mode, "hidden")
        equal(started[0]?.aborted, false)
        deepEqual(failures, [])
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
      for (const { subtitle } of [first, second]) {
        equal(getEventListeners(subtitle, "load").length, 0)
        equal(getEventListeners(subtitle, "error").length, 0)
      }
      equal(timers.size, 0)
    },
  },
  {
    name: "browser history rate limiting does not make position persistence fatal",
    run: async (): Promise<void> => {
      const { context, persist_position } = await fixture()
      const stored = new Map<string, string>()
      const failure = new DOMException(
        "History updates are rate limited",
        "SecurityError",
      )
      context["history"] = {
        // WebKit's history quota is independent of localStorage availability.
        // https://github.com/WebKit/WebKit/blob/main/Source/WebCore/page/History.cpp
        replaceState: () => {
          throw failure
        },
      }
      context["localStorage"] = {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
      }

      doesNotThrow(() => persist_position(37))
      equal(stored.get("media:position:/player"), "37")
    },
  },

  {
    name: "page restoration does not let previous playback cleanup detach the new source",
    run: async (): Promise<void> => {
      const { main, media, window } = await fixture()
      const cleanup = Promise.withResolvers<void>()
      const started: AbortSignal[] = []
      const finished: number[] = []
      const failures: unknown[] = []

      void main(async (signal) => {
        started.push(signal)
        const session = started.length
        media.src = `source:${session}`
        await wait_for_abort(signal)
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
    },
  },

  {
    name: "a restored page hidden again during cleanup does not start playback",
    run: async (): Promise<void> => {
      const { main, window } = await fixture()
      const cleanup = Promise.withResolvers<void>()
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        const session = started.length
        await wait_for_abort(signal)
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
    },
  },

  {
    name: "playback teardown failures escape the page lifetime",
    run: async (): Promise<void> => {
      const { main, window } = await fixture()
      const failure = new Error("playback cleanup failed")
      const started: AbortSignal[] = []
      const finished = main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
        throw failure
      }).catch((error: unknown) => error)

      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
        window.dispatchEvent(new Event("pagehide"))
        equal(await finished, failure)

        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  },

  ...[false, true].map((synchronous) => ({
    name: `${synchronous ? "synchronous" : "already-rejected"} playback startup aborts and releases the page session`,
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const track = subtitle_fixture()
      const { main, window } = await fixture(track.subtitle, timers)
      const failure = new Error("playback startup failed")
      const started: AbortSignal[] = []
      const finished = main((signal) => {
        started.push(signal)
        if (synchronous) {
          throw failure
        }
        return Promise.reject(failure)
      }).then(
        () => undefined,
        (reason: unknown) => reason,
      )

      try {
        window.dispatchEvent(new Event("pageshow"))
        const reason = await finished
        ok(
          reason === failure ||
            (typeof reason === "object" &&
              reason !== null &&
              "error" in reason &&
              reason.error === failure),
          "startup failure must remain observable after scoped cleanup",
        )
        equal(started.length, 1)
        ok(started[0]?.aborted)
        equal(track.requests.length, 0)
        equal(getEventListeners(track.subtitle, "load").length, 0)
        equal(getEventListeners(track.subtitle, "error").length, 0)
        equal(getEventListeners(window, "pageshow").length, 0)
        equal(getEventListeners(window, "pagehide").length, 0)

        if (!synchronous) {
          track.finish("error")
        }
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(timers.size, 0)
        equal(started.length, 1)
        equal(track.requests.length, 0)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  })),

  ...[undefined, "teardown rejected"].map((failure) => ({
    name: `page teardown preserves ${typeof failure} rejection values`,
    run: async (): Promise<void> => {
      const { main, window } = await fixture()
      const started: AbortSignal[] = []
      const finished = main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
        throw failure
      }).then(
        () => ({ status: "fulfilled" }),
        (reason: unknown) => ({ status: "rejected", reason }),
      )

      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(started.length, 1)
        window.dispatchEvent(new Event("pagehide"))

        deepEqual(await finished, { status: "rejected", reason: failure })
        ok(started[0]?.aborted)
        equal(getEventListeners(window, "pagehide").length, 0)
        equal(getEventListeners(window, "pageshow").length, 0)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  })),

  {
    name: "restoring a loading subtitle does not turn cancellation into a retry loop",
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const { cancelled, finish, requests, subtitle } = subtitle_fixture()
      const { main, window } = await fixture(subtitle, timers)
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
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
        equal(requests.length, 2)
        finish("load")
        await setImmediate()
        equal(timers.size, 0)
        equal(started.at(-1)?.aborted, false)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  },

  ...(["load", "error"] as const).map((outcome) => ({
    name: `restoring a subtitle after ${outcome} while hidden reloads its revoked source`,
    run: async (): Promise<void> => {
      const { requests, subtitle, finish } = subtitle_fixture()
      const { main, window } = await fixture(subtitle)
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
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
        equal(requests.length, 2)
        equal(failures.length, 0)
      } finally {
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
      }
    },
  })),

  {
    name: "a restored pending subtitle still retries its own loading failure",
    run: async (): Promise<void> => {
      const timers = new Map<number, () => void>()
      const { cancelled, requests, subtitle, finish } = subtitle_fixture()
      const { main, window } = await fixture(subtitle, timers)
      const started: AbortSignal[] = []
      const failures: unknown[] = []
      void main(async (signal) => {
        started.push(signal)
        await wait_for_abort(signal)
      }).catch((error: unknown) => failures.push(error))

      try {
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        window.dispatchEvent(new Event("pagehide"))
        await setImmediate()
        window.dispatchEvent(new Event("pageshow"))
        await setImmediate()
        equal(requests.length, 2)

        finish("error")
        await setImmediate()
        equal(timers.size, 1)
        const scheduled = [...timers.values()]
        timers.clear()
        for (const fire of scheduled) {
          fire()
        }
        await setImmediate()
        equal(requests.length, 3)
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
    },
  },

  ...(["pending", "load", "error"] as const).flatMap((outcome) =>
    [false, true].map((visible) => ({
      name: `delayed page teardown with ${outcome} subtitles honors a final ${visible ? "show" : "hide"}`,
      run: async (): Promise<void> => {
        const timers = new Map<number, () => void>()
        const track = subtitle_fixture()
        const { main, media, window } = await fixture(track.subtitle, timers)
        const cleanup = Promise.withResolvers<void>()
        const started: AbortSignal[] = []
        const live = new Set<number>()
        const failures: unknown[] = []
        void main(async (signal) => {
          equal(
            live.size,
            0,
            "the preceding owner must finish before replacement",
          )
          started.push(signal)
          const session = started.length
          live.add(session)
          media.src = `source:${session}`
          await wait_for_abort(signal)
          if (session === 1) {
            await cleanup.promise
          }
          media.removeAttribute("src")
          live.delete(session)
        }).catch((error: unknown) => failures.push(error))

        try {
          window.dispatchEvent(new Event("pageshow"))
          await setImmediate()
          equal(started.length, 1)
          equal(track.requests.length, 1)
          window.dispatchEvent(new Event("pagehide"))
          await setImmediate()
          ok(started[0]?.aborted)
          equal(getEventListeners(track.subtitle, "load").length, 0)
          equal(getEventListeners(track.subtitle, "error").length, 0)

          if (outcome !== "pending") {
            track.finish(outcome)
            await setImmediate()
          }
          window.dispatchEvent(new Event("pageshow"))
          await setImmediate()
          if (!visible) {
            window.dispatchEvent(new Event("pagehide"))
            await setImmediate()
          }
          equal(started.length, 1)
          equal(
            live.size,
            1,
            "aborted work remains owned until cleanup finishes",
          )
          cleanup.resolve()
          await setImmediate()

          equal(started.length, visible ? 2 : 1)
          equal(live.size, visible ? 1 : 0)
          equal(media.src, visible ? "source:2" : "")
          equal(track.requests.length, visible ? 2 : 1)
          equal(track.cancelled.length, 0)
          equal(timers.size, 0)
          deepEqual(failures, [])
        } finally {
          cleanup.resolve()
          window.dispatchEvent(new Event("pagehide"))
          await setImmediate()
        }
        equal(live.size, 0)
        equal(getEventListeners(track.subtitle, "load").length, 0)
        equal(getEventListeners(track.subtitle, "error").length, 0)
        equal(timers.size, 0)
      },
    })),
  ),
]

await run_cases(cases)

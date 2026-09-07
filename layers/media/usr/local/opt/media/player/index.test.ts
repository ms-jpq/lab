import { deepEqual, equal, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import nodeTest, { type TestContext } from "node:test"
import { setTimeout as nodeSetTimeout } from "node:timers"
import vm from "node:vm"
import { BUFFER_HIGH, BUFFER_LOW } from "./reducer.ts"

type Range = readonly [start: number, end: number]

type PlayerContext = vm.Context & {
  player_test: {
    main: (
      playback: (signal: AbortSignal) => Promise<undefined>,
    ) => Promise<void>
    play_media: (signal: AbortSignal) => Promise<undefined>
    playback: (signal: AbortSignal) => Promise<undefined>
    media_sources: (signal: AbortSignal) => AsyncIteratorObject<unknown>
  }
}

type TestCase = Readonly<{
  name: string
  run: (context: TestContext) => Promise<void>
}>

type FixtureOptions = Readonly<{
  append_completion?: "automatic" | "pending"
  append_duration?: number
  append_failures?: number
  buffer_failures?: number
  immediate_timers?: boolean
  media_duration?: number
  recovery_timers?: boolean
  source_open?: "automatic" | "manual"
  response?: "eof" | "partial" | "pending"
  storage_failure?: boolean
  stored_position?: number
  subtitle?: boolean
  url_position?: number
}>

const REQUEST_TIMEOUT = 15_000
const RESUME_AT = BUFFER_HIGH - BUFFER_LOW + 1

class Ranges implements TimeRanges {
  readonly values: Range[] = []

  get length(): number {
    return this.values.length
  }

  start(index: number): number {
    const range = this.values[index]
    ok(range)
    return range[0]
  }

  end(index: number): number {
    const range = this.values[index]
    ok(range)
    return range[1]
  }
}

class Media extends EventTarget {
  readonly HAVE_METADATA = 1
  readonly HAVE_FUTURE_DATA = 3
  readonly dataset = {
    duration: "200",
    mseType: "video/mp4",
    src: "/media",
  } as DOMStringMap

  buffered: Ranges = new Ranges()
  currentTime = 0
  ended = false
  error: MediaError | null = null
  loads = 0
  paused = false
  readyState = this.HAVE_METADATA
  seeking = false
  src = ""

  update_time(time: number): void {
    this.currentTime = time
    this.dispatchEvent(new Event("timeupdate"))
  }

  load(): void {
    this.loads += 1
  }

  pause(): void {
    this.paused = true
  }

  async play(): Promise<void> {
    this.paused = false
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = ""
    }
  }
}

const PLAYER = [
  "util.ts",
  "mse.ts",
  "media.ts",
  "reducer.ts",
  "page.ts",
  "index.ts",
].map((name) => new URL(name, import.meta.url))

const options = { concurrency: true, timeout: 2_000 }

const response_from = (
  body: ReadableStream<Uint8Array<ArrayBuffer>> | null,
  status = 200,
): Response =>
  ({
    body,
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Unavailable",
  }) as Response

const request_position = (request: Request | undefined): string | null =>
  new URL(request?.url ?? "https://example.test").searchParams.get("t")

const next_task = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve))

const eventually = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
  ok(predicate())
}

const without_imports = (source: string): string => {
  let importing = false
  return source
    .split("\n")
    .filter((line) => {
      if (line.startsWith("import ")) {
        importing = !line.includes(" from ")
        return false
      }
      if (!importing) {
        return true
      }
      importing = !line.includes(" from ")
      return false
    })
    .join("\n")
}

const fixture = async ({
  append_completion = "automatic",
  append_duration = 60,
  append_failures = 0,
  buffer_failures = 0,
  immediate_timers = false,
  media_duration = 200,
  recovery_timers = false,
  source_open = "automatic",
  response = "eof",
  storage_failure = false,
  stored_position,
  subtitle: with_subtitle = false,
  url_position,
}: FixtureOptions = {}) => {
  const errors: unknown[][] = []
  const media = new Media()
  media.dataset["duration"] = String(media_duration)
  const requests: Request[] = []
  const replacements: string[] = []
  const revoked: string[] = []
  const sources: TestMediaSource[] = []
  const subtitle_sources: string[] = []
  const time_input = { value: String(url_position ?? 0) }
  const form = {
    action: "https://example.test/player",
    elements: {
      namedItem: () => time_input,
    },
    onsubmit: null as ((event: SubmitEvent) => void) | null,
  }
  class Subtitle extends EventTarget {
    readonly dataset = { src: "/subtitle" } as DOMStringMap
    readonly NONE = 0
    readonly LOADING = 1
    readonly LOADED = 2
    readonly ERROR = 3
    readyState: number = this.NONE
    private value = ""

    get src(): string {
      return this.value
    }

    set src(value: string) {
      this.value = value
      this.readyState = this.LOADING
      subtitle_sources.push(value)
    }

    override dispatchEvent(event: Event): boolean {
      if (event.type === "load") {
        this.readyState = this.LOADED
      }
      if (event.type === "error") {
        this.readyState = this.ERROR
      }
      return super.dispatchEvent(event)
    }
  }
  const subtitle = with_subtitle ? new Subtitle() : null
  const location = {
    href:
      url_position === undefined
        ? "https://example.test/player"
        : `https://example.test/player?t=${url_position}`,
    pathname: "/player",
    replace: (target: string | URL) => {
      location.href = String(target)
      replacements.push(String(target))
    },
  }
  let remaining_append_failures = append_failures
  let remaining_buffer_failures = buffer_failures
  let partial_sent = false
  let fetch_response: (request: Request) => Promise<Response> | Response

  class TestSourceBuffer extends EventTarget {
    readonly appended: Uint8Array<ArrayBuffer>[] = []
    readonly buffered = new Ranges()
    readonly removed: Range[] = []
    timestampOffset = 0
    updating = false

    abort(): void {
      this.updating = false
    }

    appendBuffer(bytes: Uint8Array<ArrayBuffer>): void {
      if (remaining_append_failures > 0) {
        remaining_append_failures -= 1
        throw new Error("append failed")
      }

      this.appended.push(bytes)
      this.buffered.values.push([
        this.timestampOffset,
        this.timestampOffset + append_duration,
      ])
      this.updating = true
      if (append_completion === "automatic") {
        queueMicrotask(() => {
          this.updating = false
          this.dispatchEvent(new Event("update"))
          this.dispatchEvent(new Event("updateend"))
        })
      }
    }

    remove(start: number, end: number): void {
      this.removed.push([start, end])
      this.updating = true
      queueMicrotask(() => {
        this.updating = false
        this.dispatchEvent(new Event("update"))
        this.dispatchEvent(new Event("updateend"))
      })
    }
  }

  class TestMediaSource extends EventTarget {
    readonly sourceBuffers: TestSourceBuffer[] = []
    duration = Number.NaN
    readyState: "closed" | "ended" | "open" = "closed"

    constructor() {
      super()
      sources.push(this)
    }

    addSourceBuffer(_mime_type: string): TestSourceBuffer {
      if (remaining_buffer_failures > 0) {
        remaining_buffer_failures -= 1
        throw new Error("buffer acquisition failed")
      }
      const buffer = new TestSourceBuffer()
      this.sourceBuffers.push(buffer)
      media.buffered = buffer.buffered
      return buffer
    }

    endOfStream(): void {
      this.readyState = "ended"
    }

    open(): void {
      this.readyState = "open"
      this.dispatchEvent(new Event("sourceopen"))
    }
  }

  class PlayerURL extends URL {
    static override createObjectURL(value: Blob | MediaSource): string {
      ok(value instanceof TestMediaSource)
      const url = `blob:player-${crypto.randomUUID()}`
      if (source_open === "automatic") {
        queueMicrotask(() => value.open())
      }
      return url
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url)
    }
  }

  const default_response = (request: Request): Response => {
    const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start: (controller) => {
        if (response === "eof") {
          controller.enqueue(new Uint8Array([1]))
          controller.close()
          return
        }
        if (response === "partial" && !partial_sent) {
          partial_sent = true
          controller.enqueue(new Uint8Array([1]))
        }

        const aborted = () => controller.error(request.signal.reason)
        if (request.signal.aborted) {
          aborted()
          return
        }
        request.signal.addEventListener("abort", aborted, { once: true })
      },
    })

    return {
      body,
      ok: true,
      status: 200,
      statusText: "OK",
    } as Response
  }
  fetch_response = default_response

  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const request = input as Request
    requests.push(request)
    return fetch_response(request)
  }

  const window = new EventTarget()
  const schedule = (run: () => void, milliseconds = 0) => {
    const delay =
      recovery_timers || (immediate_timers && milliseconds !== REQUEST_TIMEOUT)
        ? 0
        : milliseconds
    const timer = nodeSetTimeout(run, delay)
    if (milliseconds === REQUEST_TIMEOUT && !recovery_timers) {
      timer.unref()
    }
    return timer
  }
  const PlayerAbortSignal = {
    any: AbortSignal.any.bind(AbortSignal),
    timeout: (milliseconds: number) => {
      const controller = new AbortController()
      const timer = nodeSetTimeout(
        () =>
          controller.abort(
            new DOMException("The operation timed out", "TimeoutError"),
          ),
        recovery_timers ? 0 : milliseconds,
      )
      if (!recovery_timers) {
        timer.unref()
      }
      return controller.signal
    },
  }
  const context = vm.createContext({
    AbortController,
    AbortSignal: PlayerAbortSignal,
    clearTimeout,
    console: {
      error: (...values: unknown[]) => errors.push(values),
    },
    crypto,
    document: {
      querySelector: (selector: string) => {
        if (selector === "video, audio") {
          return media
        }
        if (selector === "#subtitle") {
          return subtitle
        }
        return form
      },
    },
    DOMException,
    Event,
    EventTarget,
    fetch,
    FormData: class {
      *[Symbol.iterator](): IterableIterator<readonly [string, string]> {
        yield ["t", time_input.value]
      }
    },
    history: {
      replaceState: (_state: unknown, _unused: string, url: string | URL) => {
        location.href = String(url)
      },
    },
    localStorage: {
      getItem: () => {
        if (storage_failure) {
          throw new Error("storage unavailable")
        }
        return stored_position === undefined ? null : String(stored_position)
      },
      setItem: () => undefined,
    },
    location,
    MediaError: { MEDIA_ERR_ABORTED: 1 },
    MediaSource: TestMediaSource,
    Promise,
    queueMicrotask,
    Request,
    ReadableStream,
    setTimeout: schedule,
    Uint8Array,
    URL: PlayerURL,
    URLSearchParams,
    window,
  }) as PlayerContext

  const source = without_imports(
    (await Promise.all(PLAYER.map((url) => readFile(url, "utf8")))).join("\n"),
  )
    .replace(/^export /gmu, "")
    .replace(/^void main\(playback\)\.catch\(console\.error\)$/gmu, "")

  vm.runInContext(
    stripTypeScriptTypes(
      `${source}
globalThis.player_test = {
  main,
  play_media: (signal) => play_media(signal, playback_transitions(page_position())),
  playback,
}`,
      { mode: "strip" },
    ),
    context,
  )

  vm.runInContext(
    `player_test.media_sources = (signal) => media_sources({
      media, mime_type, signal, evict_behind: 30, timeout: 10_000,
    })`,
    context,
  )

  return {
    context,
    errors,
    form,
    media,
    open_source: (index: number): void => {
      const source = sources[index]
      ok(source)
      source.open()
    },
    replacements,
    requests,
    revoked,
    set_fetch: (
      next: (request: Request) => Promise<Response> | Response,
    ): void => {
      fetch_response = next
    },
    sources,
    subtitle,
    subtitle_sources,
    time_input,
    window,
  }
}

const retry_clock = (context: PlayerContext): (() => void) => {
  const retries: (() => void)[] = []
  const schedule = context["setTimeout"] as (
    run: () => void,
    milliseconds: number,
  ) => ReturnType<typeof nodeSetTimeout>
  context["setTimeout"] = (run: () => void, milliseconds: number) => {
    const timer = schedule(run, milliseconds === 1_000 ? 60_000 : milliseconds)
    if (milliseconds === 1_000) {
      timer.unref()
      retries.push(() => {
        clearTimeout(timer)
        run()
      })
    }
    return timer
  }
  return () => {
    for (const retry of retries.splice(0)) {
      retry()
    }
  }
}

const cases = [
  ...[0, 100].map((target): TestCase => ({
    name: `audit: request reopening honors the latest seek ${target} while removal is pending`,
    run: async () => {
      const current = await fixture({ url_position: 120, append_duration: 40 })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        bodies[0]!.enqueue(new Uint8Array([1]))
        await eventually(() => current.media.buffered.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        bodies[0]!.close()
        await eventually(() => current.sources[0]?.readyState === "ended")
        const source = current.sources[0]
        const buffer = source?.sourceBuffers[0]
        ok(source)
        ok(buffer)
        source.duration = 160
        Object.defineProperty(current.media, "duration", {
          get: () => source.duration,
        })
        buffer.remove = (start, end) => {
          buffer.removed.push([start, end])
          source.readyState = "open"
          buffer.updating = true
        }
        current.media.currentTime = 0
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => buffer.updating)
        if (target !== 0) {
          current.media.currentTime = target
          current.media.dispatchEvent(new Event("seeking"))
          current.media.dispatchEvent(new Event("waiting"))
          await next_task()
        }
        buffer.updating = false
        buffer.dispatchEvent(new Event("update"))
        buffer.dispatchEvent(new Event("updateend"))
        await eventually(() => bodies.length === 2)
        equal(request_position(current.requests[1]), String(target))
      } finally {
        owner.abort()
        await playback
      }
    },
  })),
  {
    name: "audit: a same-request seek before a retained future range preserves the parser prefix",
    run: async () => {
      const current = await fixture({ url_position: 120, append_duration: 40 })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        bodies[0]!.enqueue(new Uint8Array([1]))
        await eventually(() => current.media.buffered.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        deepEqual(current.media.buffered.values, [[120, 160]])
        current.media.currentTime = 100
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => bodies.length === 2)
        const buffer = current.sources[0]?.sourceBuffers[0]
        const body = bodies[1]
        ok(buffer)
        ok(body)
        equal(request_position(current.requests[1]), "100")
        const box = new Uint8Array([0, 0, 0, 12, 109, 100, 97, 116, 1, 2, 3, 4])
        let prefix = new Uint8Array(0)
        let completed = 0
        buffer.abort = () => {
          prefix = new Uint8Array(0)
          buffer.updating = false
        }
        buffer.appendBuffer = (bytes) => {
          prefix = new Uint8Array([...prefix, ...bytes])
          buffer.updating = true
          if (
            prefix.length === box.length &&
            prefix.every((value, index) => value === box[index])
          ) {
            completed += 1
            prefix = new Uint8Array(0)
          }
          if (bytes.length !== 10) {
            queueMicrotask(() => {
              buffer.updating = false
              buffer.dispatchEvent(new Event("update"))
              buffer.dispatchEvent(new Event("updateend"))
            })
          }
        }
        body.enqueue(box.slice(0, 10))
        await eventually(() => buffer.updating)
        current.media.currentTime = 100.01
        current.media.dispatchEvent(new Event("seeking"))
        await next_task()
        if (buffer.updating) {
          buffer.updating = false
          buffer.dispatchEvent(new Event("update"))
          buffer.dispatchEvent(new Event("updateend"))
        }
        body.enqueue(box.slice(10))
        await next_task()
        await next_task()
        deepEqual(
          { requests: current.requests.length, completed },
          { requests: 2, completed: 1 },
        )
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  ...[10, 10.05].map((target): TestCase => ({
    name: `audit: a seek to ${target} applies the normalized retained range start 10.05`,
    run: async () => {
      const current = await fixture({ response: "pending", url_position: 50 })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.buffered.values.push([10.05, 100])
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()

        let time = current.media.currentTime
        Object.defineProperty(current.media, "currentTime", {
          get: () => time,
          set: (value: number) => {
            time = value
            current.media.seeking = true
            setImmediate(() => {
              current.media.dispatchEvent(new Event("seeking"))
              if (
                current.media.buffered.values.some(
                  ([start, end]) => start <= time && time < end,
                )
              ) {
                current.media.seeking = false
                current.media.dispatchEvent(new Event("seeked"))
              } else {
                current.media.dispatchEvent(new Event("waiting"))
              }
            })
          },
        })
        current.media.currentTime = target
        for (let task = 0; task < 4; task += 1) {
          await next_task()
        }
        deepEqual(
          { time: current.media.currentTime, seeking: current.media.seeking },
          {
            time: 10.05,
            seeking: false,
          },
        )
      } finally {
        owner.abort()
        await playback
      }
    },
  })),
  {
    name: "audit: a fractional native frame endpoint still pauses fetching at high water",
    run: async () => {
      const current = await fixture({ append_duration: BUFFER_HIGH + 2 / 30 })
      let body:
        ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              body = controller
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        ok(body)
        body.enqueue(new Uint8Array([1]))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        await next_task()
        body.enqueue(new Uint8Array([2]))
        await next_task()
        deepEqual(
          {
            appends: current.sources[0]?.sourceBuffers[0]?.appended.length,
            aborted: current.requests[0]?.signal.aborted,
          },
          { appends: 1, aborted: true },
        )
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "audit: native completion supplies an initially unknown media duration",
    run: async () => {
      const current = await fixture({ media_duration: 0, append_duration: 10 })
      let body:
        ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined
      current.set_fetch(() => {
        const source = current.sources[0]
        ok(source)
        Object.defineProperty(current.media, "duration", {
          configurable: true,
          get: () => source.duration,
        })
        source.endOfStream = () => {
          source.duration = 10
          source.readyState = "ended"
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              if (current.requests.length === 1) {
                body = controller
              }
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        ok(body)
        body.enqueue(new Uint8Array([1]))
        body.close()
        await eventually(() => current.sources[0]?.readyState === "ended")
        current.media.currentTime = 10
        current.media.dispatchEvent(new Event("timeupdate"))
        current.media.paused = true
        current.media.ended = true
        current.media.dispatchEvent(new Event("ended"))
        await next_task()
        deepEqual(
          {
            positions: current.requests.map(request_position),
            persisted: current.time_input.value,
          },
          { positions: ["0"], persisted: "0" },
        )
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "audit: a newer explicit pause cancels deferred source-recovery playback",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const pending = Promise.withResolvers<void>()
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      let plays = 0
      try {
        await eventually(() => current.requests.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        let src = current.media.src
        Object.defineProperty(current.media, "src", {
          get: () => src,
          set: (value: string) => {
            src = value
            current.media.paused = true
            current.media.readyState = 0
          },
        })
        current.media.play = async () => {
          plays += 1
          current.media.paused = false
          setImmediate(() => current.media.dispatchEvent(new Event("play")))
          if (current.media.readyState < current.media.HAVE_FUTURE_DATA) {
            await pending.promise
          }
        }
        current.media.pause = () => {
          if (!current.media.paused) {
            current.media.paused = true
            setImmediate(() => {
              current.media.dispatchEvent(new Event("timeupdate"))
              current.media.dispatchEvent(new Event("pause"))
              pending.reject(new DOMException("paused", "AbortError"))
            })
          }
        }
        const source = current.sources[0]
        ok(source)
        source.readyState = "closed"
        source.dispatchEvent(new Event("sourceclose"))
        await eventually(() => current.requests.length === 2)
        const user_play = current.media.play().catch((error: unknown) => {
          ok(error instanceof DOMException)
          equal(error.code, DOMException.ABORT_ERR)
        })
        current.media.pause()
        await user_play
        await next_task()
        equal(current.media.paused, true)
        equal(plays, 1)
        current.media.readyState = current.media.HAVE_FUTURE_DATA
        current.media.dispatchEvent(new Event("canplay"))
        await next_task()
        equal(
          plays,
          1,
          "metadata arrival must not undo the newer explicit pause",
        )
        equal(current.media.paused, true)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  ...[false, true].map((paused): TestCase => ({
    name: `audit: repeated outer append-failure recovery preserves ${paused ? "a user pause" : "active playback intent"}`,
    run: async () => {
      const current = await fixture({ append_failures: 1, response: "pending" })
      const tick = retry_clock(current.context)
      let body:
        ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              body = controller
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.playback(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        current.media.paused = paused
        await next_task()
        let src = current.media.src
        let plays = 0
        Object.defineProperty(current.media, "src", {
          get: () => src,
          set: (value: string) => {
            src = value
            current.media.paused = true
          },
        })
        current.media.play = async () => {
          plays += 1
          current.media.paused = false
        }
        ok(body)
        body.enqueue(new Uint8Array([1]))
        await eventually(() => current.errors.length === 1)
        await next_task()
        tick()
        await eventually(() => current.requests.length === 2)
        current.media.readyState = current.media.HAVE_FUTURE_DATA
        current.media.dispatchEvent(new Event("canplay"))
        await next_task()
        equal(
          plays,
          paused ? 0 : 1,
          "recreating the dispatcher must not forget that playback was active",
        )
        equal(current.media.paused, paused)

        const buffer = current.sources[1]?.sourceBuffers[0]
        ok(buffer)
        buffer.appendBuffer = () => {
          throw new Error("second append failed")
        }
        current.media.currentTime = 12.25
        body.enqueue(new Uint8Array([2]))
        await eventually(() => current.errors.length === 2)
        await next_task()
        tick()
        await eventually(() => current.requests.length === 3)
        equal(request_position(current.requests[2]), "12.25")
        current.media.dispatchEvent(new Event("canplay"))
        await next_task()
        equal(plays, paused ? 0 : 2)
        equal(current.media.paused, paused)
      } finally {
        owner.abort()
        await playback
      }
    },
  })),
  {
    name: "audit: a fatal error batched with a clock observation resumes only the replacement source",
    run: async () => {
      const current = await fixture({
        append_completion: "pending",
        append_duration: 1,
        response: "partial",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)
      const played: string[] = []
      try {
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.updating === true,
        )
        const buffer = current.sources[0]?.sourceBuffers[0]
        ok(buffer)
        let src = current.media.src
        Object.defineProperty(current.media, "src", {
          get: () => src,
          set: (value: string) => {
            src = value
            current.media.paused = true
            current.media.error = null
          },
        })
        current.media.play = async () => {
          played.push(current.media.src)
          current.media.paused = false
        }
        current.media.paused = false
        current.media.dispatchEvent(new Event("progress"))
        await next_task()
        current.media.error = {
          code: 3,
          message: "decode failed",
        } as MediaError
        current.media.dispatchEvent(new Event("error"))
        await next_task()
        current.media.dispatchEvent(new Event("timeupdate"))
        await next_task()
        buffer.updating = false
        buffer.dispatchEvent(new Event("update"))
        buffer.dispatchEvent(new Event("updateend"))
        await eventually(() => current.requests.length === 2)
        const replacement = current.media.src
        current.media.readyState = current.media.HAVE_FUTURE_DATA
        current.media.dispatchEvent(new Event("canplay"))
        await next_task()
        deepEqual(played, [replacement])
        equal(current.media.paused, false)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "quota without playable media uses the delayed recovery path instead of waiting forever",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const tick = retry_clock(current.context)
      current.set_fetch(() => {
        if (current.requests.length !== 1) {
          return response_from(new ReadableStream())
        }
        const buffer = current.sources[0]?.sourceBuffers[0]
        ok(buffer)
        buffer.appendBuffer = () => {
          throw new DOMException("full", "QuotaExceededError")
        }
        return response_from(
          new ReadableStream({
            start: (controller) => controller.enqueue(new Uint8Array(5)),
          }),
        )
      })
      const owner = new AbortController()
      const playing = current.context.player_test.playback(owner.signal)
      try {
        await eventually(() => current.requests[0]?.signal.aborted === true)
        await next_task()
        equal(current.requests.length, 1)
        deepEqual(current.errors, [])
        ok(current.requests[0]?.signal.aborted)
        tick()
        await eventually(() => current.requests.length === 2)
        equal(request_position(current.requests[1]), "0")
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  ...(
    [
      "progress",
      "buffered seek",
      "unbuffered seek",
      "error",
      "sourceclose",
    ] as const
  ).map((recovery): TestCase => ({
    name: `quota pressure keeps the event loop responsive to ${recovery}`,
    run: async () => {
      const current = await fixture({
        response: "pending",
        append_duration: 20,
      })
      const tick = retry_clock(current.context)
      const chunk = new Uint8Array(20)
      const rejected = new Uint8Array(5)
      const refetched = new Uint8Array(5).fill(2)
      const capacity = 40
      let exhausted = 0
      const attempts: Uint8Array<ArrayBuffer>[] = []
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() => {
        const buffer = current.sources.at(-1)?.sourceBuffers[0]
        ok(buffer)
        if (bodies.length === 0) {
          const append = buffer.appendBuffer.bind(buffer)
          const remove = buffer.remove.bind(buffer)
          // Constant-bitrate capacity model: retained timeline duration represents bytes.
          buffer.appendBuffer = (bytes) => {
            attempts.push(bytes)
            const retained = buffer.buffered.values.reduce(
              (total, [start, end]) => total + end - start,
              0,
            )
            if (retained + bytes.byteLength > capacity) {
              exhausted += 1
              throw new DOMException(
                "The MediaSource buffer is not sufficient",
                "QuotaExceededError",
              )
            }
            const start =
              buffer.buffered.values[0]?.[0] ?? buffer.timestampOffset
            const end =
              buffer.buffered.values.at(-1)?.[1] ?? buffer.timestampOffset
            append(bytes)
            buffer.buffered.values.splice(0, buffer.buffered.values.length, [
              start,
              end + bytes.byteLength,
            ])
          }
          buffer.remove = (start, end) => {
            const retained = buffer.buffered.values.flatMap(
              ([lo, hi]): Range[] => [
                ...(lo < start ? [[lo, Math.min(hi, start)] as const] : []),
                ...(hi > end ? [[Math.max(lo, end), hi] as const] : []),
              ],
            )
            buffer.buffered.values.splice(
              0,
              buffer.buffered.values.length,
              ...retained,
            )
            remove(start, end)
          }
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
              if (bodies.length > 1) {
                controller.enqueue(refetched)
              }
            },
          }),
        )
      })
      const owner = new AbortController()
      const playing = current.context.player_test.playback(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const body = bodies[0]
        ok(body)
        body.enqueue(chunk)
        body.enqueue(chunk)
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 2,
        )
        current.media.update_time(10)
        await eventually(() => current.time_input.value === "10")
        body.enqueue(rejected)
        await eventually(
          () => exhausted > 0 && current.requests[0]?.signal.aborted === true,
        )
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await next_task()
          tick()
          await next_task()
        }
        equal(
          current.sources.length,
          1,
          "quota recovery must retain playable data instead of rebuilding the same overfull source",
        )
        const buffer = current.sources[0]?.sourceBuffers[0]
        ok(buffer)
        current.media.dispatchEvent(new Event("timeupdate"))
        await next_task()
        equal(
          exhausted,
          1,
          "an unchanged clock must not spin on the rejected chunk",
        )
        equal(
          attempts.length,
          3,
          "do not append after aborting the full request",
        )
        equal(
          current.requests.length,
          1,
          "do not immediately refetch into a full buffer",
        )
        switch (recovery) {
          case "buffered seek":
          case "progress":
            if (recovery === "buffered seek") {
              current.media.currentTime = 15
              current.media.dispatchEvent(new Event("seeking"))
              current.media.dispatchEvent(new Event("seeked"))
              await eventually(() => current.time_input.value === "15")
              equal(current.requests.length, 1)
            }
            current.media.update_time(38)
            await eventually(() => buffer.appended.length === 3)
            equal(attempts.at(-1), refetched)
            equal(request_position(current.requests[1]), "40")
            equal(buffer.timestampOffset, 40)
            equal(current.time_input.value, "38")
            equal(current.requests.length, 2)
            equal(current.sources.length, 1)
            deepEqual(current.errors, [])
            break
          case "unbuffered seek":
            current.media.currentTime = 110
            current.media.dispatchEvent(new Event("seeking"))
            await eventually(() => current.requests.length >= 2)
            equal(request_position(current.requests[1]), "110")
            equal(current.sources.length, 1)
            break
          case "error":
            current.media.paused = true
            current.media.error = { code: 3 } as MediaError
            current.media.dispatchEvent(new Event("error"))
            await eventually(() => current.sources.length >= 2)
            break
          case "sourceclose":
            current.media.paused = true
            Object.assign(current.sources[0]!, { readyState: "closed" })
            current.sources[0]!.dispatchEvent(new Event("sourceclose"))
            await eventually(() => current.sources.length >= 2)
            break
        }
      } finally {
        owner.abort()
        await playing
      }
    },
  })),
  {
    name: "audit: a premature native ended event does not erase resumable page progress",
    run: async () => {
      const current = await fixture({
        response: "pending",
        append_duration: BUFFER_LOW,
      })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const body = bodies[0]
        ok(body)
        body.enqueue(new Uint8Array([1]))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        current.media.update_time(BUFFER_LOW - 1)
        await eventually(
          () => current.time_input.value === String(BUFFER_LOW - 1),
        )
        body.close()
        await eventually(() => current.sources[0]?.readyState === "ended")
        current.media.currentTime = BUFFER_LOW
        current.media.ended = true
        current.media.dispatchEvent(new Event("ended"))
        await next_task()
        ok(
          Number(current.time_input.value) >= BUFFER_LOW - 1,
          "recovery must not lose the last playable position",
        )
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  {
    name: "audit: a failed transport does not retry beyond an already buffered media end",
    run: async () => {
      const length = BUFFER_HIGH - 1
      const current = await fixture({
        response: "pending",
        append_duration: length,
        url_position: 200 - length,
      })
      const tick = retry_clock(current.context)
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const body = bodies[0]
        ok(body)
        body.enqueue(new Uint8Array([1]))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        const failure = new Error("transport reset after the final media bytes")
        body.error(failure)
        await eventually(() => current.errors.length === 1)
        await next_task()
        tick()
        await next_task()
        deepEqual(current.errors, [[failure]])
        deepEqual(current.requests.map(request_position), [
          String(200 - length),
        ])
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  {
    name: "audit: a clean short response resumes from its appended end, not its original request start",
    run: async () => {
      const current = await fixture({
        response: "pending",
        append_duration: BUFFER_LOW,
      })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => bodies.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const body = bodies[0]
        ok(body)
        body.enqueue(new Uint8Array([1]))
        body.close()
        await eventually(() => current.sources[0]?.readyState === "ended")
        current.media.update_time(1)
        await eventually(() => current.requests.length === 2)
        equal(current.sources[0]?.sourceBuffers[0]?.timestampOffset, BUFFER_LOW)
        equal(request_position(current.requests[1]), String(BUFFER_LOW))
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  {
    name: "audit: a seek into an older buffered range resumes acquisition at that range's end",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const initial = bodies[0]
        ok(initial)
        initial.enqueue(new Uint8Array([1]))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        current.media.currentTime = 120
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => current.requests.length === 2)
        current.media.currentTime = 10
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => current.requests[1]?.signal.aborted === true)
        await next_task()
        equal(current.requests.length, 2)
        current.media.seeking = false
        current.media.dispatchEvent(new Event("seeked"))
        current.media.update_time(60 - BUFFER_LOW)
        await next_task()
        equal(current.requests.length, 2)
        current.media.update_time(60 - BUFFER_LOW + 1)
        await eventually(() => current.requests.length === 3)
        equal(request_position(current.requests[2]), "60")
        equal(current.requests[1]?.signal.aborted, true)
        current.media.seeking = false
        current.media.dispatchEvent(new Event("seeked"))
        const body = bodies[2]
        ok(body)
        body.enqueue(new Uint8Array([2]))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 2,
        )
        deepEqual(current.media.buffered.values, [
          [0, 60],
          [60, 120],
        ])
        await next_task()
        current.media.update_time(55)
        await next_task()
        equal(current.requests.length, 3)
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  ...[
    { position: 0, targets: [] },
    { position: 0, targets: [10] },
    { position: 0, targets: [110, 10] },
    { position: 0, targets: [20] },
    { position: 0, targets: [20.05] },
    { position: 0, targets: [0] },
    { position: 40, targets: [40] },
    {
      position: 0,
      targets: [120],
      ranges: [
        [0, 20],
        [100, 120],
      ] as const,
      requested: 120,
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      position: 0,
      targets: [110, 10],
      microtasks: index + 1,
    })),
  ].map(
    ({
      position,
      targets,
      microtasks = 0,
      ranges = [[0, 20]],
      requested,
    }: {
      position: number
      targets: number[]
      microtasks?: number
      ranges?: readonly Range[]
      requested?: number
    }): TestCase => ({
      name: `audit: split box from ${position} completes across seeks ${JSON.stringify(targets)} with ${microtasks} microtasks between them`,
      run: async () => {
        const current = await fixture({
          response: "pending",
          url_position: position,
        })
        const bodies: ReadableStreamDefaultController<
          Uint8Array<ArrayBuffer>
        >[] = []
        const box = new Uint8Array([0, 0, 0, 12, 109, 100, 97, 116, 1, 2, 3, 4])
        current.set_fetch(() =>
          response_from(
            new ReadableStream({
              start: (controller) => {
                bodies.push(controller)
                if (bodies.length > 1) {
                  controller.enqueue(box)
                }
              },
            }),
          ),
        )
        const owner = new AbortController()
        const playing = current.context.player_test.play_media(owner.signal)
        try {
          await eventually(() => bodies.length === 1)
          const buffer = current.sources[0]?.sourceBuffers[0]
          const body = bodies[0]
          ok(buffer)
          ok(body)
          if (position === 0) {
            buffer.buffered.values.push(...ranges)
            current.media.dispatchEvent(new Event("seeked"))
          }
          await next_task()

          // Model only ISO BMFF box framing and abort's parser reset, not decoding.
          let pending = new Uint8Array(0)
          let completed = 0
          buffer.abort = () => {
            pending = new Uint8Array(0)
            buffer.updating = false
          }
          buffer.appendBuffer = (bytes) => {
            pending = new Uint8Array([...pending, ...bytes])
            buffer.updating = true
            if (pending.length >= 8) {
              const size = new DataView(pending.buffer).getUint32(0)
              if (size === box.length && pending.length === size) {
                completed += 1
                pending = new Uint8Array(0)
              }
            }
            if (bytes.length !== 10) {
              queueMicrotask(() => {
                buffer.updating = false
                buffer.dispatchEvent(new Event("update"))
                buffer.dispatchEvent(new Event("updateend"))
              })
            }
          }

          body.enqueue(box.slice(0, 10))
          await eventually(() => buffer.updating)
          for (const target of targets) {
            current.media.currentTime = target
            current.media.seeking = true
            current.media.dispatchEvent(new Event("seeking"))
            for (let turn = 0; turn < microtasks; turn += 1) {
              await Promise.resolve()
            }
          }
          await next_task()
          if (buffer.updating) {
            buffer.updating = false
            buffer.dispatchEvent(new Event("update"))
            buffer.dispatchEvent(new Event("updateend"))
          }
          if (targets.length > 0) {
            current.media.seeking = false
            current.media.dispatchEvent(new Event("seeked"))
          }
          if (!current.requests[0]?.signal.aborted) {
            body.enqueue(box.slice(10))
          }
          await next_task()
          await next_task()
          ok(
            completed > 0,
            "the complete box must survive seeking, including its prefix",
          )
          if (requested !== undefined) {
            equal(current.requests.length, 2)
            equal(request_position(current.requests[1]), String(requested))
          } else if (microtasks === 0) {
            equal(
              current.requests.length,
              1,
              "seeks within the current request retain its parser and connection",
            )
          }
        } finally {
          owner.abort()
          await playing
        }
      },
    }),
  ),
  {
    name: "audit: delayed MediaSource teardown cannot detach a restored page's source",
    run: async () => {
      const current = await fixture()
      const cleanup = Promise.withResolvers<void>()
      const sessions: string[] = []
      const finished: number[] = []
      const failures: unknown[] = []
      void current.context.player_test
        .main(async (signal) => {
          for await (const _ of current.context.player_test.media_sources(
            signal,
          )) {
            sessions.push(current.media.src)
            const session = sessions.length
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true })
            })
            if (session === 1) {
              await cleanup.promise
            }
            finished.push(session)
            break
          }
          return undefined
        })
        .catch((error: unknown) => failures.push(error))
      try {
        current.window.dispatchEvent(new Event("pageshow"))
        await eventually(() => sessions.length === 1)
        current.window.dispatchEvent(new Event("pagehide"))
        await next_task()
        current.window.dispatchEvent(new Event("pageshow"))
        await next_task()
        cleanup.resolve()
        await eventually(() => finished.includes(1) && sessions.length === 2)
        await next_task()
        deepEqual(failures, [])
        const restored = sessions[1]
        ok(restored)
        equal(current.media.src, restored)
        equal(current.revoked.includes(restored), false)
      } finally {
        cleanup.resolve()
        current.window.dispatchEvent(new Event("pagehide"))
        await next_task()
      }
    },
  },
  ...["error", "sourceclose"].flatMap((type) =>
    [false, true].map((observed): TestCase => ({
      name: `audit: ${type} recovery resumes at the current playback position ${observed ? "after" : "before"} timeupdate`,
      run: async () => {
        const current = await fixture({ response: "pending" })
        const owner = new AbortController()
        const playing = current.context.player_test.play_media(owner.signal)
        try {
          await eventually(() => current.requests.length === 1)
          current.media.dispatchEvent(new Event("seeked"))
          await next_task()
          current.media.buffered.values.push([0, 60])
          if (observed) {
            current.media.update_time(20)
            await next_task()
            equal(current.time_input.value, "20")
          } else {
            current.media.currentTime = 20
          }
          if (type === "error") {
            current.media.error = { code: 3 } as MediaError
            current.media.dispatchEvent(new Event("error"))
          } else {
            const source = current.sources[0]
            ok(source)
            source.readyState = "closed"
            source.dispatchEvent(new Event("sourceclose"))
          }
          await eventually(() => current.requests.length === 2)
          deepEqual(current.requests.map(request_position), ["0", "20"])
          equal(current.media.currentTime, 20)
        } finally {
          owner.abort()
          await playing
        }
      },
    })),
  ),
  {
    name: "audit: a newer user seek replaces an older projected seek in the same batch",
    run: async () => {
      const current = await fixture({ response: "pending", url_position: 40 })
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.currentTime = 0
        current.media.dispatchEvent(new Event("canplay"))
        current.media.currentTime = 110
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => current.requests.length === 2)
        equal(request_position(current.requests[1]), "110")
        equal(current.media.currentTime, 110)
      } finally {
        owner.abort()
        await playing
      }
    },
  },
  ...[200, 199.98].map((end): TestCase => ({
    name: `audit: natural playback completion at ${end} does not start another request`,
    run: async () => {
      const current = await fixture({ append_duration: end })
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.sources[0]?.readyState === "ended")
        const source = current.sources[0]
        ok(source)
        source.duration = end
        current.media.currentTime = end
        current.media.ended = true
        current.media.dispatchEvent(new Event("ended"))
        await next_task()
        equal(current.requests.length, 1)
        equal(current.sources[0]?.readyState, "ended")
      } finally {
        owner.abort()
        await playing
      }
    },
  })),
  ...[
    { type: "timeupdate", time: RESUME_AT, position: String(BUFFER_HIGH) },
    { type: "waiting", time: BUFFER_HIGH, position: String(BUFFER_HIGH) },
    {
      type: "seeking",
      time: BUFFER_HIGH + 10,
      position: String(BUFFER_HIGH + 10),
    },
  ].map(({ type, time, position }): TestCase => ({
    name: `${type} resumes fetching when it overtakes an acknowledged high-water pause`,
    run: async () => {
      const current = await fixture({ append_duration: BUFFER_HIGH })
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch(() =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playing = current.context.player_test.play_media(owner.signal)
      try {
        await eventually(() => current.requests.length === 1)
        current.media.dispatchEvent(new Event("seeked"))
        await next_task()
        const body = bodies[0]
        ok(body)
        body.enqueue(Uint8Array.of(1))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        await next_task()
        equal(current.requests[0]?.signal.aborted, false)

        current.media.currentTime = time
        current.media.seeking = type === "seeking"
        current.media.dispatchEvent(new Event(type))
        await eventually(() => current.requests.length === 2)
        equal(current.requests[0]?.signal.aborted, true)
        deepEqual(current.requests.map(request_position), ["0", position])
        const resumed = bodies[1]
        ok(resumed)
        resumed.enqueue(Uint8Array.of(2))
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 2,
        )
        equal(
          current.sources[0]?.sourceBuffers[0]?.timestampOffset,
          Number(position),
        )
        equal(current.sources.length, 1)
        equal(current.media.loads, 0)
        equal(current.media.currentTime, time)
      } finally {
        owner.abort()
        await playing
      }
    },
  })),
  {
    name: "pagehide detaches media listeners and pageshow reinstalls them once",
    run: async () => {
      const current = await fixture({ response: "pending" })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(() => current.requests.length === 1)
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("waiting"))
      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
      equal(getEventListeners(current.media, "waiting").length, 0)
      current.media.update_time(1)
      await next_task()

      current.window.dispatchEvent(new Event("pageshow"))
      try {
        await eventually(() => current.requests.length === 2)
        equal(getEventListeners(current.media, "waiting").length, 1)
        current.media.dispatchEvent(new Event("playing"))
        current.media.update_time(0.1)
        await next_task()
        equal(current.requests.length, 2)
      } finally {
        current.window.dispatchEvent(new Event("pagehide"))
        await eventually(() => current.media.src === "")
      }
    },
  },
  {
    name: "a pre-aborted lifetime starts no source or request",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      owner.abort()

      await current.context.player_test.play_media(owner.signal)

      deepEqual(current.sources, [])
      deepEqual(current.requests, [])
      equal(current.media.loads, 1)
    },
  },
  {
    name: "a finite high-water response reaches end of stream",
    run: async () => {
      const current = await fixture({ append_duration: BUFFER_HIGH })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources[0]?.readyState === "ended")

      equal(current.sources.length, 1)
      equal(current.sources[0]?.duration, 200)
      equal(current.requests.length, 1)
      const request = current.requests[0]
      ok(request)
      equal(new URL(request.url).searchParams.get("t"), "0")
      deepEqual(
        current.sources[0]?.sourceBuffers[0]?.appended[0],
        Uint8Array.of(1),
      )

      owner.abort()
      await playback
    },
  },
  {
    name: "an unbuffered seek aborts its request without replacing MediaSource",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const initial = current.requests[0]
      ok(initial)

      current.media.currentTime = 100
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))

      await eventually(() => current.requests.length === 2)

      equal(initial.signal.aborted, true)
      equal(current.sources.length, 1)
      equal(
        new URL(current.requests[1]?.url ?? "").searchParams.get("t"),
        "100",
      )

      owner.abort()
      await playback
    },
  },
  {
    name: "a buffered seek retains its active request",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const initial = current.requests[0]
      ok(initial)
      current.media.buffered.values.push([0, 120])

      current.media.currentTime = 100
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await new Promise((resolve) => setImmediate(resolve))

      equal(initial.signal.aborted, false)
      equal(current.requests.length, 1)
      equal(current.time_input.value, "100")

      owner.abort()
      await playback
    },
  },
  {
    name: "a media failure rebuilds MediaSource",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const initial = current.requests[0]
      ok(initial)

      current.media.error = { code: 3 } as MediaError
      current.media.dispatchEvent(new Event("error"))

      await eventually(() => current.sources.length === 2)

      equal(initial.signal.aborted, true)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a live MediaSource close rebuilds playback",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const active = current.context.player_test.playback(owner.signal)

      try {
        await eventually(() => current.requests.length === 1)
        const source = current.sources[0]
        const request = current.requests[0]
        ok(source)
        ok(request)
        source.dispatchEvent(new Event("sourceclose"))

        await eventually(() => current.sources.length === 2)
        equal(request.signal.aborted, true)
      } finally {
        owner.abort()
        await active
      }
    },
  },
  {
    name: "a live MediaSource close interrupts a pending append",
    run: async () => {
      const current = await fixture({ append_completion: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        const source = current.sources[0]
        const request = current.requests[0]
        ok(source)
        ok(request)
        source.readyState = "closed"
        source.dispatchEvent(new Event("sourceclose"))

        await eventually(() => current.sources.length === 2)
        equal(request.signal.aborted, true)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "an unbuffered seek interrupts a pending append",
    run: async () => {
      const current = await fixture({ append_completion: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        const request = current.requests[0]
        ok(request)
        current.media.currentTime = 110
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))

        await eventually(() => current.requests.length === 2)
        equal(request.signal.aborted, true)
        equal(request_position(current.requests[1]), "110")
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "low water resumes acquisition at the buffered frontier",
    run: async () => {
      const current = await fixture({ append_duration: BUFFER_HIGH })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources[0]?.readyState === "ended")
      current.media.dispatchEvent(new Event("progress"))
      await new Promise((resolve) => setImmediate(resolve))
      equal(current.requests.length, 1)

      current.media.currentTime = RESUME_AT
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => current.requests.length === 2)

      equal(request_position(current.requests[1]), String(BUFFER_HIGH))

      owner.abort()
      await playback
    },
  },
  {
    name: "high water pauses acquisition until playback reaches low water",
    run: async () => {
      const current = await fixture({
        append_duration: BUFFER_HIGH,
        response: "pending",
      })
      let first = true
      current.set_fetch((request) =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              if (first) {
                first = false
                controller.enqueue(Uint8Array.of(1))
              }
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              )
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
      )
      const initial = current.requests[0]
      ok(initial)
      current.media.dispatchEvent(new Event("progress"))
      await eventually(() => initial.signal.aborted)
      await next_task()

      equal(current.requests.length, 1)

      current.media.currentTime = RESUME_AT
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => current.requests.length === 2)

      equal(request_position(current.requests[1]), String(BUFFER_HIGH))

      owner.abort()
      await playback
    },
  },
  {
    name: "a synchronous seek storm requests only its final target",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      for (const position of [40, 70, 110]) {
        current.media.currentTime = position
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
      }
      await eventually(() => current.requests.length === 2)

      deepEqual(current.requests.map(request_position), ["0", "110"])
      equal(current.sources.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a same-target seek retains its pending request",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const request = current.requests[0]
      ok(request)
      current.media.currentTime = 0
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await next_task()

      equal(request.signal.aborted, false)
      equal(current.requests.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a different target does not await its retired body read",
    run: async () => {
      const current = await fixture()
      const bodies: ReadableStreamDefaultController<Uint8Array<ArrayBuffer>>[] =
        []
      current.set_fetch((request) =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
              request.signal.addEventListener("abort", () => undefined, {
                once: true,
              })
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(
          () => current.requests.length === 1 && bodies.length === 1,
        )
        const initial = current.requests[0]
        ok(initial)
        current.media.currentTime = 110
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        await eventually(() => initial.signal.aborted)
        await eventually(() => current.requests.length === 2)

        equal(request_position(current.requests[1]), "110")
      } finally {
        owner.abort()
        for (const body of bodies) {
          body.error(owner.signal.reason)
        }
        await playback
      }
    },
  },
  {
    name: "an unrelated buffered range cannot retire the target request",
    run: async () => {
      const current = await fixture({ response: "pending", url_position: 110 })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const request = current.requests[0]
      ok(request)
      current.media.buffered.values.push([40, 100])
      current.media.dispatchEvent(new Event("progress"))
      await next_task()

      equal(request_position(request), "110")
      equal(request.signal.aborted, false)
      equal(current.requests.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a partial request failure retries from its buffered frontier",
    run: async () => {
      const current = await fixture({
        append_duration: 20,
        immediate_timers: true,
      })
      const failure = new Error("request failed after partial progress")
      let first:
        ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined
      current.set_fetch((request) => {
        if (first !== undefined) {
          return response_from(
            new ReadableStream({
              start: (controller) => {
                request.signal.addEventListener(
                  "abort",
                  () => controller.error(request.signal.reason),
                  { once: true },
                )
              },
            }),
          )
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              first = controller
              controller.enqueue(Uint8Array.of(1))
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
      )
      current.media.dispatchEvent(new Event("progress"))
      await next_task()
      first?.error(failure)
      await eventually(() => current.requests.length === 2)

      deepEqual(current.requests.map(request_position), ["0", "20"])
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "an expected native media abort preserves playback",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const request = current.requests[0]
      ok(request)
      current.media.error = { code: 1 } as MediaError
      current.media.dispatchEvent(new Event("error"))
      await next_task()

      equal(current.sources.length, 1)
      equal(current.errors.length, 0)
      equal(request.signal.aborted, false)

      owner.abort()
      await playback
    },
  },
  {
    name: "a media failure storm reports and rebuilds once",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      current.media.error = { code: 3 } as MediaError
      current.media.dispatchEvent(new Event("error"))
      current.media.dispatchEvent(new Event("timeupdate"))
      current.media.dispatchEvent(new Event("progress"))
      await eventually(() => current.sources.length === 2)
      await next_task()

      equal(current.sources.length, 2)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a transport failure is reported and retried",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
      })
      const failure = new Error("transport failed")
      let attempts = 0
      current.set_fetch((request) => {
        attempts += 1
        if (attempts === 1) {
          throw failure
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              )
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 2)

      deepEqual(current.requests.map(request_position), ["0", "0"])
      equal(current.sources.length, 1)
      deepEqual(current.errors, [[failure]])

      owner.abort()
      await playback
    },
  },
  {
    name: "a failed transport waits before retrying",
    run: async () => {
      const current = await fixture({ response: "pending" })
      let attempts = 0
      current.set_fetch((request) => {
        attempts += 1
        if (attempts === 1) {
          throw new Error("first request failed")
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              )
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(() => current.requests.length === 1)
        await next_task()

        equal(current.requests.length, 1)
        equal(current.errors.length, 1)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "MediaSource replacement revokes the old URL only after sourceopen",
    run: async () => {
      const current = await fixture({
        response: "pending",
        source_open: "manual",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources.length === 1)
      const old_url = current.media.src
      current.open_source(0)
      await eventually(() => current.requests.length === 1)

      current.media.error = { code: 3 } as MediaError
      current.media.dispatchEvent(new Event("error"))
      await eventually(() => current.sources.length === 2)
      const new_url = current.media.src

      equal(current.revoked.includes(old_url), false)
      ok(new_url !== old_url)
      current.open_source(1)
      await eventually(() => current.revoked.includes(old_url))

      owner.abort()
      await playback
      equal(current.revoked.includes(new_url), true)
    },
  },
  {
    name: "a URL position wins over stored progress at the page boundary",
    run: async () => {
      const current = await fixture({
        response: "pending",
        stored_position: 110,
        subtitle: true,
        url_position: 40,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))

      await eventually(() => current.requests.length === 1)
      equal(request_position(current.requests[0]), "40")

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  {
    name: "stored progress initializes a page without a URL position",
    run: async () => {
      const current = await fixture({
        response: "pending",
        stored_position: 110,
        subtitle: true,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))

      await eventually(() => current.requests.length === 1)
      equal(request_position(current.requests[0]), "110")
      equal(current.time_input.value, "110")

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  {
    name: "a storage read failure starts the page from zero",
    run: async () => {
      const current = await fixture({
        response: "pending",
        storage_failure: true,
        subtitle: true,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))

      await eventually(() => current.requests.length === 1)
      equal(request_position(current.requests[0]), "0")

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  {
    name: "player settings replace the page while back remains native",
    run: async () => {
      const current = await fixture()
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      const submit = current.form.onsubmit
      ok(submit)
      let prevented = false
      submit({
        preventDefault: () => {
          prevented = true
        },
        submitter: { classList: { contains: () => false } },
      } as unknown as SubmitEvent)

      equal(prevented, true)
      deepEqual(current.replacements, ["https://example.test/player?t=0"])

      prevented = false
      submit({
        preventDefault: () => {
          prevented = true
        },
        submitter: { classList: { contains: () => true } },
      } as unknown as SubmitEvent)
      equal(prevented, false)
      equal(current.replacements.length, 1)
    },
  },
  {
    name: "a subtitle failure retries without replacing media",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
        subtitle: true,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(
        () =>
          current.requests.length === 1 &&
          current.subtitle_sources.length === 1,
      )
      const source = current.sources[0]
      current.subtitle?.dispatchEvent(new Event("error"))
      await eventually(() => current.subtitle_sources.length === 2)

      equal(current.sources.length, 1)
      equal(current.sources[0], source)
      equal(current.errors.length, 1)

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  {
    name: "pagehide cancels subtitle retry and detaches its listeners",
    run: async () => {
      const current = await fixture({ response: "pending", subtitle: true })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(() => current.subtitle_sources.length === 1)
      current.subtitle?.dispatchEvent(new Event("error"))
      await eventually(() => current.errors.length === 1)

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
      const requests = current.subtitle_sources.length
      current.subtitle?.dispatchEvent(new Event("error"))
      current.subtitle?.dispatchEvent(new Event("load"))
      await next_task()

      equal(current.subtitle_sources.length, requests)
    },
  },
  {
    name: "an owned startup seek is consumed by its native acknowledgement",
    run: async () => {
      const current = await fixture({ response: "pending", url_position: 40 })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      current.media.dispatchEvent(new Event("timeupdate"))
      await next_task()

      equal(current.requests.length, 1)
      equal(current.requests[0]?.signal.aborted, false)
      equal(current.time_input.value, "40")

      owner.abort()
      await playback
    },
  },
  {
    name: "error then seek rebuilds once at the sought target",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      current.media.error = { code: 3 } as MediaError
      current.media.dispatchEvent(new Event("error"))
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(
        () =>
          current.sources.length === 2 &&
          request_position(current.requests.at(-1)) === "110",
      )

      equal(current.sources.length, 2)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "seek then error rebuilds once at the sought target",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.error = { code: 3 } as MediaError
      current.media.dispatchEvent(new Event("error"))
      await eventually(
        () =>
          current.sources.length === 2 &&
          request_position(current.requests.at(-1)) === "110",
      )

      equal(current.sources.length, 2)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "page progress persists only playable positions",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      current.media.buffered.values.push([0, 60])
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await next_task()
      current.media.currentTime = 20
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => current.time_input.value === "20")

      current.media.currentTime = 110
      current.media.dispatchEvent(new Event("timeupdate"))
      await next_task()
      equal(current.time_input.value, "20")

      owner.abort()
      await playback
    },
  },
  {
    name: "ended resets persisted progress",
    run: async () => {
      const current = await fixture()
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources[0]?.readyState === "ended")
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await next_task()
      current.media.currentTime = 20
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => current.time_input.value === "20")
      current.media.currentTime = Number(current.media.dataset["duration"])
      current.media.ended = true
      current.media.dispatchEvent(new Event("ended"))
      await eventually(() => current.time_input.value === "0")

      owner.abort()
      await playback
    },
  },
  {
    name: "exact-end startup requests the nearest playable position",
    run: async () => {
      const current = await fixture({ response: "pending", url_position: 200 })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      equal(request_position(current.requests[0]), "199.5")
      equal(current.media.currentTime, 199.5)

      owner.abort()
      await playback
    },
  },
  {
    name: "a non-OK response retires without draining its body",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
      })
      let cancellations = 0
      let attempts = 0
      current.set_fetch((request) => {
        attempts += 1
        if (attempts === 1) {
          return response_from(
            new ReadableStream({
              cancel: () => {
                cancellations += 1
              },
            }),
            503,
          )
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              )
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 2)
      equal(current.requests[0]?.signal.aborted, true)
      equal(cancellations, 0)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "each failed transport attempt is reported",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
      })
      const failures = [new Error("first"), new Error("second")]
      let attempts = 0
      current.set_fetch((request) => {
        const failure = failures[attempts]
        attempts += 1
        if (failure !== undefined) {
          throw failure
        }
        return response_from(
          new ReadableStream({
            start: (controller) => {
              request.signal.addEventListener(
                "abort",
                () => controller.error(request.signal.reason),
                { once: true },
              )
            },
          }),
        )
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 3)
      deepEqual(
        current.errors.map(([failure]) => failure),
        failures,
      )
      equal(current.sources.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "a failed SourceBuffer acquisition is reported and rebuilt",
    run: async () => {
      const current = await fixture({
        buffer_failures: 1,
        immediate_timers: true,
        response: "pending",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.playback(owner.signal)

      await eventually(() => current.requests.length === 1)
      equal(current.sources.length, 2)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "completed appends drive high-water backpressure",
    run: async () => {
      const current = await fixture({
        append_duration: BUFFER_HIGH,
        recovery_timers: true,
        response: "partial",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.appended.length === 1,
        )
        const request = current.requests[0]
        ok(request)
        await eventually(() => request.signal.aborted)

        equal(current.requests.length, 1)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "an inactive request retries from its acknowledged frontier",
    run: async () => {
      const current = await fixture({
        append_duration: 20,
        recovery_timers: true,
        response: "partial",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      try {
        await eventually(() => current.requests.length === 2)

        deepEqual(current.requests.map(request_position), ["0", "20"])
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "a stalled SourceBuffer mutation rebuilds MediaSource",
    run: async () => {
      const current = await fixture({
        append_completion: "pending",
        immediate_timers: true,
        recovery_timers: true,
      })
      const owner = new AbortController()
      const playback = current.context.player_test.playback(owner.signal)

      try {
        await eventually(() => current.sources.length === 2)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "a missing sourceopen rebuilds MediaSource",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        recovery_timers: true,
        response: "pending",
        source_open: "manual",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.playback(owner.signal)

      try {
        await eventually(() => current.sources.length === 2)
      } finally {
        owner.abort()
        await playback
      }
    },
  },
  {
    name: "lifetime abort while sourceopen is pending releases its URL",
    run: async () => {
      const current = await fixture({
        response: "pending",
        source_open: "manual",
      })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources.length === 1)
      const url = current.media.src
      owner.abort()
      await playback

      equal(current.requests.length, 0)
      equal(current.media.src, "")
      equal(current.revoked.includes(url), true)
    },
  },
  {
    name: "each failed subtitle attempt is reported",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
        subtitle: true,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(() => current.subtitle_sources.length === 1)
      current.subtitle?.dispatchEvent(new Event("error"))
      await eventually(() => current.subtitle_sources.length === 2)
      current.subtitle?.dispatchEvent(new Event("error"))
      await eventually(() => current.subtitle_sources.length === 3)

      equal(current.errors.length, 2)

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  {
    name: "subtitle load completes without a retry",
    run: async () => {
      const current = await fixture({
        immediate_timers: true,
        response: "pending",
        subtitle: true,
      })
      void current.context.player_test.main(
        current.context.player_test.play_media,
      )
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(() => current.subtitle_sources.length === 1)
      current.subtitle?.dispatchEvent(new Event("load"))
      await next_task()

      equal(current.subtitle_sources.length, 1)
      equal(current.errors.length, 0)
      ok(current.media.src !== "")

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
  ...(["paused", "playing", "append", "abort", "reject"] as const).map(
    (mode): TestCase => ({
      name: `audit: rebuilding a source owns playback resumption: ${mode}`,
      run: async () => {
        const paused = mode === "paused"
        const current = await fixture({ response: "pending" })
        const pending = Promise.withResolvers<void>()
        let body:
          ReadableStreamDefaultController<Uint8Array<ArrayBuffer>> | undefined
        let calls = 0
        let settled = false
        current.set_fetch(() =>
          response_from(
            new ReadableStream({
              start: (controller) => {
                body = controller
              },
            }),
          ),
        )
        const owner = new AbortController()
        const playback = current.context.player_test.play_media(owner.signal)
        try {
          await eventually(() => current.requests.length === 1)
          current.media.seeking = false
          current.media.dispatchEvent(new Event("seeked"))
          current.media.paused = paused
          current.media.readyState = current.media.HAVE_FUTURE_DATA
          await next_task()

          let src = current.media.src
          Object.defineProperty(current.media, "src", {
            get: () => src,
            set: (value: string) => {
              src = value
              // Loading a new media resource sets paused=true, even after play().
              // https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm
              current.media.paused = true
            },
          })
          Object.assign(current.media, {
            play: () => {
              calls += 1
              current.media.paused = false
              if (mode === "playing") {
                return Promise.resolve()
              }
              return pending.promise.finally(() => {
                settled = true
              })
            },
            pause: () => {
              current.media.paused = true
              if (mode !== "playing") {
                pending.reject(new DOMException("paused", "AbortError"))
              }
            },
          })
          const source = current.sources[0]
          ok(source)
          source.readyState = "closed"
          source.dispatchEvent(new Event("sourceclose"))

          await eventually(() => current.requests.length === 2)
          current.media.readyState = current.media.HAVE_FUTURE_DATA
          current.media.dispatchEvent(new Event("canplay"))
          await next_task()
          equal(current.media.paused, paused)
          equal(calls, paused ? 0 : 1)
          if (mode === "append") {
            ok(body)
            body.enqueue(new Uint8Array([1]))
            await eventually(
              () => current.sources[1]?.sourceBuffers[0]?.appended.length === 1,
            )
            equal(settled, false)
            pending.resolve()
            await eventually(() => settled)
          }
          if (mode === "reject") {
            const error = new DOMException("blocked", "NotAllowedError")
            pending.reject(error)
            await eventually(() => current.errors.length === 1)
            deepEqual(current.errors, [[error]])
          }
        } finally {
          owner.abort()
          await playback
        }
        if (mode === "abort") {
          equal(settled, true)
          deepEqual(current.errors, [])
        }
      },
    }),
  ),
  {
    name: "lifetime abort drains the request and detaches media",
    run: async () => {
      const current = await fixture({ response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      const request = current.requests[0]
      ok(request)

      owner.abort()
      await playback

      equal(request.signal.aborted, true)
      equal(current.media.src, "")
      equal(current.media.loads, 1)
      ok(current.revoked.length > 0)
    },
  },
] as const satisfies readonly TestCase[]

const shuffled = cases
  .map((test_case) => ({ order: crypto.randomUUID(), test_case }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ test_case }) => test_case)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

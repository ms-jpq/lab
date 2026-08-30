import { deepEqual, equal, ok } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import nodeTest, { type TestContext } from "node:test"
import vm from "node:vm"

type Range = readonly [start: number, end: number]

type PlayerContext = vm.Context & {
  player_test: {
    main: (
      playback: (signal: AbortSignal) => Promise<undefined>,
    ) => Promise<never>
    play_media: (signal: AbortSignal) => Promise<undefined>
  }
}

type TestCase = Readonly<{
  name: string
  run: (context: TestContext) => Promise<void>
}>

type FixtureOptions = Readonly<{
  append_duration?: number
  append_failures?: number
  buffer_failures?: number
  immediate_timers?: boolean
  source_open?: "automatic" | "manual"
  response?: "eof" | "pending"
  storage_failure?: boolean
  stored_position?: number
  subtitle?: boolean
  url_position?: number
}>

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
  readyState = this.HAVE_METADATA
  seeking = false
  src = ""

  load(): void {
    this.loads += 1
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.src = ""
    }
  }
}

const PLAYER = ["util.ts", "mse.ts", "reducer.ts", "page.ts", "index.ts"].map(
  (name) => new URL(name, import.meta.url),
)

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
  append_duration = 60,
  append_failures = 0,
  buffer_failures = 0,
  immediate_timers = false,
  source_open = "automatic",
  response = "eof",
  storage_failure = false,
  stored_position,
  subtitle: with_subtitle = false,
  url_position,
}: FixtureOptions = {}) => {
  const errors: unknown[][] = []
  const media = new Media()
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
    private value = ""

    get src(): string {
      return this.value
    }

    set src(value: string) {
      this.value = value
      subtitle_sources.push(value)
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
      queueMicrotask(() => {
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      })
    }

    remove(start: number, end: number): void {
      this.removed.push([start, end])
      this.updating = true
      queueMicrotask(() => {
        this.updating = false
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
  const context = vm.createContext({
    AbortController,
    AbortSignal,
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
    Request,
    ReadableStream,
    setTimeout: immediate_timers
      ? (run: TimerHandler) => setTimeout(run, 0)
      : setTimeout,
    Uint8Array,
    URL: PlayerURL,
    URLSearchParams,
    window,
  }) as PlayerContext

  const source = without_imports(
    (await Promise.all(PLAYER.map((url) => readFile(url, "utf8")))).join("\n"),
  )
    .replace(/^export /gmu, "")
    .replace(/^void main\(play_media\)\.catch\(console\.error\)$/gmu, "")

  vm.runInContext(
    stripTypeScriptTypes(
      `${source}
globalThis.player_test = { main, play_media }`,
      { mode: "strip" },
    ),
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

const cases = [
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
    name: "startup streams bytes through one MediaSource",
    run: async () => {
      const current = await fixture()
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources[0]?.readyState === "ended")

      equal(current.sources.length, 1)
      equal(current.requests.length, 1)
      equal(new URL(current.requests[0]?.url ?? "").searchParams.get("t"), "0")
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
    name: "a SourceBuffer failure rebuilds MediaSource",
    run: async () => {
      const current = await fixture({ append_failures: 1 })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources.length === 2)

      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "low water resumes acquisition at the buffered frontier",
    run: async () => {
      const current = await fixture()
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.sources[0]?.readyState === "ended")
      current.media.dispatchEvent(new Event("progress"))
      await new Promise((resolve) => setImmediate(resolve))
      equal(current.requests.length, 1)

      current.media.currentTime = 20
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => current.requests.length === 2)

      equal(new URL(current.requests[1]?.url ?? "").searchParams.get("t"), "60")

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
    name: "a different target retires its pending read before replacement",
    run: async () => {
      const current = await fixture()
      const bodies: ReadableStreamDefaultController<
        Uint8Array<ArrayBuffer>
      >[] = []
      current.set_fetch((request) =>
        response_from(
          new ReadableStream({
            start: (controller) => {
              bodies.push(controller)
              request.signal.addEventListener(
                "abort",
                () => undefined,
                { once: true },
              )
            },
          }),
        ),
      )
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1 && bodies.length === 1)
      const initial = current.requests[0]
      ok(initial)
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(() => initial.signal.aborted)
      await next_task()
      equal(current.requests.length, 1)

      bodies[0]?.error(initial.signal.reason)
      await eventually(() => current.requests.length === 2)
      equal(request_position(current.requests[1]), "110")

      owner.abort()
      bodies[1]?.error(owner.signal.reason)
      await playback
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
      const current = await fixture({ append_duration: 20 })
      const failure = new Error("request failed after partial progress")
      let first: ReadableStreamDefaultController<
        Uint8Array<ArrayBuffer>
      > | undefined
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
      const current = await fixture({ response: "pending" })
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
      const current = await fixture({ response: "pending" })
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
      const current = await fixture({ response: "pending" })
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
    name: "MediaSource replacement revokes the old URL only after sourceopen",
    run: async () => {
      const current = await fixture({ response: "pending", source_open: "manual" })
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      void current.context.player_test.main(current.context.player_test.play_media)
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(
        () => current.requests.length === 1 && current.subtitle_sources.length === 1,
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      const current = await fixture({ response: "pending" })
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
      const current = await fixture({ response: "pending" })
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
      const current = await fixture({ buffer_failures: 1, response: "pending" })
      const owner = new AbortController()
      const playback = current.context.player_test.play_media(owner.signal)

      await eventually(() => current.requests.length === 1)
      equal(current.sources.length, 2)
      equal(current.errors.length, 1)

      owner.abort()
      await playback
    },
  },
  {
    name: "lifetime abort while sourceopen is pending releases its URL",
    run: async () => {
      const current = await fixture({ response: "pending", source_open: "manual" })
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
      void current.context.player_test.main(current.context.player_test.play_media)
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
      void current.context.player_test.main(current.context.player_test.play_media)
      current.window.dispatchEvent(new Event("pageshow"))
      await eventually(() => current.subtitle_sources.length === 1)
      current.subtitle?.dispatchEvent(new Event("load"))
      await next_task()

      equal(current.subtitle_sources.length, 1)
      equal(current.errors.length, 0)

      current.window.dispatchEvent(new Event("pagehide"))
      await eventually(() => current.media.src === "")
    },
  },
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

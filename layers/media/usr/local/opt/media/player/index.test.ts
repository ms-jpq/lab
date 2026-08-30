import { deepEqual, equal, ok } from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import nodeTest, { type TestContext } from "node:test"
import vm from "node:vm"

type Range = readonly [start: number, end: number]

type PlayerContext = vm.Context & {
  player_test: {
    play_media: (signal: AbortSignal) => Promise<undefined>
  }
}

type TestCase = Readonly<{
  name: string
  run: (context: TestContext) => Promise<void>
}>

type FixtureOptions = Readonly<{
  append_failures?: number
  response?: "eof" | "pending"
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
  append_failures = 0,
  response = "eof",
}: FixtureOptions = {}) => {
  const errors: unknown[][] = []
  const media = new Media()
  const requests: Request[] = []
  const revoked: string[] = []
  const sources: TestMediaSource[] = []
  const time_input = { value: "0" }
  const form = {
    action: "https://example.test/player",
    elements: {
      namedItem: () => time_input,
    },
  }
  const location = {
    href: "https://example.test/player",
    pathname: "/player",
    replace: (target: string | URL) => {
      location.href = String(target)
    },
  }
  let remaining_append_failures = append_failures

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
        this.timestampOffset + 60,
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
      const buffer = new TestSourceBuffer()
      this.sourceBuffers.push(buffer)
      media.buffered = buffer.buffered
      return buffer
    }

    endOfStream(): void {
      this.readyState = "ended"
    }
  }

  class PlayerURL extends URL {
    static override createObjectURL(value: Blob | MediaSource): string {
      ok(value instanceof TestMediaSource)
      const url = `blob:player-${crypto.randomUUID()}`
      queueMicrotask(() => {
        value.readyState = "open"
        value.dispatchEvent(new Event("sourceopen"))
      })
      return url
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url)
    }
  }

  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const request = input as Request
    requests.push(request)

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
          return null
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
      getItem: () => null,
      setItem: () => undefined,
    },
    location,
    MediaError: { MEDIA_ERR_ABORTED: 1 },
    MediaSource: TestMediaSource,
    Promise,
    Request,
    ReadableStream,
    setTimeout,
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
globalThis.player_test = { play_media }`,
      { mode: "strip" },
    ),
    context,
  )

  return {
    context,
    errors,
    media,
    requests,
    revoked,
    sources,
    time_input,
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

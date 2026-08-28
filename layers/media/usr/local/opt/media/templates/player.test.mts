import { readFile } from "node:fs/promises"
import {
  deepEqual,
  doesNotReject,
  match,
  notEqual,
  ok as assert,
  rejects,
} from "node:assert/strict"
import nodeTest, { type TestContext } from "node:test"
import vm from "node:vm"

const PLAYER = new URL("player.js", import.meta.url)
const options = { concurrency: true, timeout: 2_000 }

type Range = [number, number]
type MutableTimeRanges = {
  ranges: Range[]
  readonly length: number
  start: (index: number) => number
  end: (index: number) => number
}
type MediaFailure = { code: number; message?: string }
type MseOperation = "end" | number | Uint8Array
type Mse = AsyncGenerator<void, void, MseOperation>
type MseBuffer = EventTarget & {
  abort: () => void
  appendBuffer: (bytes: Uint8Array) => void
  buffered: MutableTimeRanges
  remove: (start: number, end: number) => void
  timestampOffset: number
}
type TestMseBuffer = MseBuffer & {
  aborts: number
  appendState: string
  holdUpdate: boolean
  releaseUpdate: (() => void) | undefined
  removes: Range[]
  updating: boolean
  usable: boolean
}
type MseSource = EventTarget & {
  addSourceBuffer: (type: string) => MseBuffer
  endOfStream: () => void
  readyState: "closed" | "open" | "ended"
}
type TestMseSource = Omit<MseSource, "addSourceBuffer"> & {
  addSourceBuffer: (type: string) => TestMseBuffer
}
type Diagnostics = {
  error: (error: unknown) => void
  progress: () => void
}
type Target = { position: number; restart: boolean; started: boolean }
type SourcePage = {
  next: <T>(work?: Promise<T>) => Promise<symbol | T | undefined>
  readonly target: Target
  take_error: () => unknown
}
type PageReader = SourcePage & {
  close: () => Promise<void>
  seek: () => void
}
type PlayerTest = {
  PULSE: symbol
  mse: (signal: AbortSignal, source: MseSource, buffer: MseBuffer) => Mse
  page_reader: (signal: AbortSignal, position: number) => PageReader
  play_source: (
    buffer: {
      next: (operation: MseOperation) => Promise<IteratorResult<void>>
    },
    failures: Diagnostics,
    page: SourcePage,
  ) => Promise<{ failure: unknown } | void>
  play_subtitle: (signal: AbortSignal) => Promise<void>
  playback_page: (signal: AbortSignal) => Promise<void>
  selector: <T>(
    source: AsyncIterator<T, void, void>,
  ) => <W>(work?: Promise<W>) => Promise<T | W | undefined>
  request_stream: (
    position: number,
  ) => {
    next: () => Promise<IteratorResult<Uint8Array, unknown>>
    return: () => Promise<IteratorResult<Uint8Array, unknown>>
  }
}
type MockResponse = {
  body: {
    getReader: () => {
      cancel: () => Promise<void>
      read: () => Promise<ReadableStreamReadResult<Uint8Array>>
    }
  }
  ok: boolean
  status: number
  statusText: string
}
type MockFetch = (
  url: string | URL | Request,
  init: { signal: AbortSignal },
) => Promise<MockResponse>
type PlayerContext = vm.Context & {
  clearTimeout: (timeout: ReturnType<typeof setTimeout>) => void
  fetch: MockFetch
  MediaError: { MEDIA_ERR_ABORTED: number }
  MediaSource: new () => TestMseSource
  player_test: PlayerTest
  setTimeout: (run: () => void, delay?: number) => ReturnType<typeof setTimeout>
  URL: typeof URL
}
type TestBody = (context: TestContext) => void | Promise<void>
type TestCase = { name: string; run: TestBody }

const cases: TestCase[] = []
const test = (name: string, _options: typeof options, run: TestBody): void => {
  cases.push({ name, run })
}
const present = <T,>(value: T | undefined): T => {
  assert(value !== undefined)
  return value
}
const eventually = async (predicate: () => boolean): Promise<void> => {
  while (!predicate()) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))
const frozenClock = (context: PlayerContext) => {
  const scheduled: Array<{
    invoke: () => void
    timeout: ReturnType<typeof setTimeout>
  }> = []
  const retries = new Set<ReturnType<typeof setTimeout>>()
  let callbacks = 0
  let cancellations = 0
  context.clearTimeout = (timeout) => {
    if (retries.has(timeout)) {
      cancellations += 1
    }
    clearTimeout(timeout)
  }
  context.setTimeout = (run, delay = 0) => {
    if (delay === 0) {
      return setTimeout(run, 0)
    }
    const invoke = () => {
      callbacks += 1
      run()
    }
    const timeout = setTimeout(invoke, 10_000)
    retries.add(timeout)
    scheduled.push({
      invoke: () => {
        clearTimeout(timeout)
        invoke()
      },
      timeout,
    })
    return timeout
  }
  return {
    advance: (index: number) => present(scheduled[index]).invoke(),
    get callbacks() {
      return callbacks
    },
    get cancellations() {
      return cancellations
    },
    dispose: () => {
      for (const { timeout } of scheduled) {
        clearTimeout(timeout)
      }
    },
    get length() {
      return scheduled.length
    },
  }
}

const mockResponse = (body: MockResponse["body"]): MockResponse => ({
  body,
  ok: true,
  status: 200,
  statusText: "OK",
})

const liveResponse = (signal: AbortSignal): MockResponse =>
  mockResponse(
    new ReadableStream<Uint8Array>({
      start: (controller) => {
        controller.enqueue(new Uint8Array([1]))
        signal.addEventListener("abort", () => controller.close(), {
          once: true,
        })
      },
    }),
  )

const timeRanges = (): MutableTimeRanges => ({
  ranges: [],
  get length() {
    return this.ranges.length
  },
  start(index: number) {
    return this.ranges[index]![0]
  },
  end(index: number) {
    return this.ranges[index]![1]
  },
})

const listenerCapture = (
  options: EventListenerOptions | boolean | undefined,
): boolean =>
  typeof options === "boolean" ? options : (options?.capture ?? false)

class TrackedEventTarget extends EventTarget {
  listenerCalls: number
  private listenerWrappers: WeakMap<
    EventListenerOrEventListenerObject,
    Map<string, Map<boolean, EventListener>>
  >

  constructor() {
    super()
    this.listenerCalls = 0
    this.listenerWrappers = new WeakMap()
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (callback === null) {
      super.addEventListener(type, callback, options)
      return
    }
    const capture = listenerCapture(options)
    const types = this.listenerWrappers.get(callback) ?? new Map()
    const captures = types.get(type) ?? new Map()
    const wrapped =
      captures.get(capture) ??
      ((event: Event) => {
        this.listenerCalls += 1
        if (typeof callback === "function") {
          callback.call(this, event)
        } else {
          callback.handleEvent(event)
        }
      })
    captures.set(capture, wrapped)
    types.set(type, captures)
    this.listenerWrappers.set(callback, types)
    super.addEventListener(type, wrapped, options)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (callback === null) {
      super.removeEventListener(type, callback, options)
      return
    }
    const capture = listenerCapture(options)
    const types = this.listenerWrappers.get(callback)
    const captures = types?.get(type)
    const wrapped = captures?.get(capture)
    super.removeEventListener(type, wrapped ?? callback, options)
    if (wrapped === undefined) {
      return
    }
    captures?.delete(capture)
    if (captures?.size === 0) {
      types?.delete(type)
    }
    if (types?.size === 0) {
      this.listenerWrappers.delete(callback)
    }
  }
}

class Media extends TrackedEventTarget {
  readonly HAVE_METADATA: number
  currentTimes: number[]
  private _currentTime: number
  buffered: MutableTimeRanges
  dataset: { duration: string; mseType: string; src: string }
  ended: boolean
  error: MediaFailure | null
  seeking: boolean
  private _src: string
  loads: number
  removals: number
  readyState: number
  onLoad: (() => void) | undefined
  onSourceChange: ((previous: string, current: string) => void) | undefined
  topology: string[]

  constructor() {
    super()
    this.HAVE_METADATA = 1
    this.currentTimes = []
    this._currentTime = 0
    this.buffered = timeRanges()
    this.dataset = {
      duration: "200",
      mseType: 'video/mp4; codecs="avc1.640028"',
      src: "/movie/stream",
    }
    this.ended = false
    this.error = null
    this.seeking = false
    this._src = ""
    this.loads = 0
    this.removals = 0
    this.readyState = 0
    this.onSourceChange = undefined
    this.topology = []
  }

  get currentTime() {
    return this._currentTime
  }

  set currentTime(value: number) {
    this._currentTime = value
    this.currentTimes.push(value)
    this.topology.push(`time:${value}`)
  }

  get src() {
    return this._src
  }

  set src(value: string) {
    const previous = this._src
    this._src = value
    this.topology.push(`src:${value}`)
    this.buffered.ranges = []
    this.error = null
    this.readyState = 0
    this.currentTime = 0
    this.onSourceChange?.(previous, value)
  }

  load(): void {
    this.loads += 1
    this.topology.push("load")
    this.buffered.ranges = []
    this.onLoad?.()
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this.removals += 1
      this.topology.push("remove")
      this._src = ""
    }
  }
}

class Subtitle extends TrackedEventTarget {
  dataset: { src: string }
  sources: string[]
  private _src: string

  constructor() {
    super()
    this.dataset = { src: "/movie/subtitle" }
    this.sources = []
    this._src = ""
  }

  get src() {
    return this._src
  }

  set src(value: string) {
    this._src = value
    this.sources.push(value)
  }
}

const fixture = async (position = 40) => {
  const media = new Media()
  const subtitle = new Subtitle()
  const timeInput = { value: String(position) }
  const form = {
    action: "https://media.test/movie",
    elements: { namedItem: () => timeInput },
    onsubmit: undefined,
  }
  const location = {
    href: `https://media.test/movie?t=${position}`,
    pathname: "/movie",
    replace: () => {},
  }
  const requests: string[] = []
  const revoked: string[] = []
  const sources: MediaSource[] = []
  const errors: unknown[][] = []
  const window = new EventTarget()
  class SourceBuffer extends EventTarget {
    source: MediaSource
    private _buffered: MutableTimeRanges
    private _timestampOffset: number
    aborts: number
    abortError: unknown
    appendState: string
    holdUpdate: boolean
    removes: Range[]
    releaseUpdate: (() => void) | undefined
    updating: boolean
    usable: boolean

    constructor(source: MediaSource) {
      super()
      this.source = source
      this._buffered = timeRanges()
      this._timestampOffset = 0
      this.aborts = 0
      this.abortError = undefined
      this.appendState = "waiting"
      this.holdUpdate = false
      this.removes = []
      this.releaseUpdate = undefined
      this.updating = false
      this.usable = true
    }

    get buffered() {
      if (!this.usable) {
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
      return this._buffered
    }

    get timestampOffset() {
      return this._timestampOffset
    }

    set timestampOffset(value: number) {
      if (!this.usable || this.updating) {
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
      if (this.source.readyState === "ended") {
        this.source.readyState = "open"
        queueMicrotask(() => this.source.dispatchEvent(new Event("sourceopen")))
      }
      if (this.appendState === "parsing") {
        throw new DOMException(
          "SourceBuffer is parsing a media segment",
          "InvalidStateError",
        )
      }
      this._timestampOffset = value
    }

    abort(): void {
      if (this.abortError) {
        throw this.abortError
      }
      if (!this.usable || this.source.readyState !== "open") {
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
      this.aborts += 1
      this.appendState = "waiting"
      this.updating = false
    }

    appendBuffer(_bytes: Uint8Array): void {
      if (!this.usable || this.updating) {
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
      this.updating = true
      this.appendState = "parsing"
      const complete = () => {
        const ranges: Range[] = [
          [this.timestampOffset, this.timestampOffset + 10],
        ]
        this._buffered.ranges = ranges
        media.buffered.ranges = ranges
        if (media.readyState === 0) {
          media.readyState = 1
          media.dispatchEvent(new Event("loadedmetadata"))
        }
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      }
      if (this.holdUpdate) {
        this.releaseUpdate = complete
      } else {
        queueMicrotask(complete)
      }
    }

    remove(start: number, end: number): void {
      if (!this.usable || this.updating) {
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
      if (this.source.readyState === "ended") {
        this.source.readyState = "open"
        queueMicrotask(() => this.source.dispatchEvent(new Event("sourceopen")))
      }
      this.removes.push([start, end])
      this.updating = true
      queueMicrotask(() => {
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      })
    }
  }
  class MediaSource extends TrackedEventTarget {
    duration: number
    ends: number
    readyState: "closed" | "open" | "ended"
    sourceBuffers: SourceBuffer[]

    constructor() {
      super()
      sources.push(this)
      this.duration = Number.NaN
      this.ends = 0
      this.readyState = "closed"
      this.sourceBuffers = []
    }

    addSourceBuffer(_type: string): SourceBuffer {
      const buffer = new SourceBuffer(this)
      this.sourceBuffers.push(buffer)
      return buffer
    }

    endOfStream(): void {
      this.ends += 1
      this.readyState = "ended"
    }
  }
  const sourceOpen = {
    hold: false,
    pending: [] as Array<() => void>,
    release: () => present(sourceOpen.pending.shift())(),
  }
  class PlayerURL extends URL {
    static override createObjectURL(
      source: Blob | globalThis.MediaSource | MediaSource,
    ): string {
      assert(source instanceof MediaSource)
      const url = `blob:player-${crypto.randomUUID()}`
      const open = () => {
        source.readyState = "open"
        media.topology.push(`open:${url}`)
        source.dispatchEvent(new Event("sourceopen"))
      }
      if (sourceOpen.hold) {
        sourceOpen.pending.push(open)
      } else {
        queueMicrotask(open)
      }
      return url
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url)
      media.topology.push(`revoke:${url}`)
    }
  }
  media.onLoad = () => {
    for (const source of sources) {
      for (const buffer of source.sourceBuffers) {
        buffer.usable = false
      }
    }
  }
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
    Event,
    EventTarget,
    DOMException,
    fetch: async (url: string | URL | Request) => {
      requests.push(String(url))
      return mockResponse(
        new ReadableStream<Uint8Array>({
          start: (controller: ReadableStreamDefaultController<Uint8Array>) => {
            controller.enqueue(new Uint8Array([1]))
            controller.close()
          },
        }),
      )
    },
    FormData,
    history: {
      replaceState: (_state: unknown, _unused: string, url: string | URL) => {
        location.href = String(url)
      },
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    location,
    MediaError: { MEDIA_ERR_ABORTED: 1 },
    MediaSource,
    Promise,
    ReadableStream,
    setTimeout: (run: () => void) => setTimeout(run, 0),
    URL: PlayerURL,
    URLSearchParams,
    Uint8Array,
    window,
  }) as PlayerContext
  const source = await readFile(PLAYER, "utf8")
  vm.runInContext(
    `${source}
globalThis.player_test = { PULSE, mse, page_reader, play_source, play_subtitle, playback_page, request_stream, selector }`,
    context,
  )
  const { ranges } = media.buffered

  return {
    context,
    errors,
    media,
    ranges,
    requests,
    revoked,
    sources,
    sourceOpen,
    subtitle,
    timeInput,
  }
}

const open_mse = async (current: Awaited<ReturnType<typeof fixture>>) => {
  const controller = new AbortController()
  const source = new current.context.MediaSource()
  source.readyState = "open"
  const opened = source.addSourceBuffer(current.media.dataset.mseType)
  const buffer = current.context.player_test.mse(
    controller.signal,
    source,
    opened,
  )
  await buffer.next()
  return { buffer, controller, opened, source }
}

test(
  "a selector subscribes once while work repeatedly wins",
  options,
  async () => {
    const current = await fixture()
    const pending = Promise.withResolvers<IteratorResult<number, void>>()
    const original = pending.promise.then
    let subscriptions = 0
    let derivedSubscriptions = 0
    Object.defineProperty(pending.promise, "then", {
      value: (...arguments_: unknown[]) => {
        subscriptions += 1
        const derived = Reflect.apply(original, pending.promise, arguments_)
        const then = derived.then
        Object.defineProperty(derived, "then", {
          value: (...derivedArguments: unknown[]) => {
            derivedSubscriptions += 1
            return Reflect.apply(then, derived, derivedArguments)
          },
        })
        return derived
      },
    })
    const select = current.context.player_test.selector({
      next: () => pending.promise,
    })

    for (let value = 0; value < 1_000; value += 1) {
      deepEqual(await select(Promise.resolve(value)), value)
    }
    deepEqual(subscriptions, 1)
    deepEqual(derivedSubscriptions, 0)

    const work = Promise.withResolvers<number>()
    const selected = select(work.promise)
    work.resolve(1_000)
    pending.resolve({ done: false, value: 1_001 })
    deepEqual(await selected, 1_000)
    deepEqual(await select(), 1_001)
    deepEqual(subscriptions, 2)
    deepEqual(derivedSubscriptions, 0)

    const source = Promise.withResolvers<IteratorResult<number, void>>()
    const losing = Promise.withResolvers<number>()
    const sourceFirst = current.context.player_test.selector({
      next: () => source.promise,
    })(losing.promise)
    source.resolve({ done: false, value: 2_000 })
    losing.reject(new Error("losing work"))
    deepEqual(await sourceFirst, 2_000)
  },
)

const readerTeardownCases = [
  {
    cancelRejects: false,
    name: "source stream reads and releases a reader-only response body",
  },
  {
    cancelRejects: true,
    name: "an aborted reader cannot reject stream teardown",
  },
] as const

for (const { cancelRejects, name } of readerTeardownCases) {
  test(name, options, async () => {
    const current = await fixture()
    let cancellations = 0
    let reads = 0
    current.context.fetch = async (_url, { signal }) =>
      mockResponse({
        getReader: () => ({
          cancel: async () => {
            cancellations += 1
            deepEqual(signal.aborted, true)
            if (cancelRejects) {
              throw new DOMException("The operation was aborted", "AbortError")
            }
          },
          read: async () => {
            reads += 1
            return { done: false, value: new Uint8Array([1]) }
          },
        }),
      })

    const stream = current.context.player_test.request_stream(40)
    const chunk = await stream.next()
    deepEqual(chunk.done, false)
    deepEqual([...chunk.value], [1])
    await doesNotReject(stream.return())

    deepEqual(reads, 1)
    deepEqual(cancellations, 1)
  })
}

test(
  "source stream clean EOF does not cancel its completed request",
  options,
  async () => {
    const current = await fixture()
    let aborts = 0
    let cancellations = 0
    let reads = 0
    current.context.fetch = async (_url, { signal }) => {
      signal.addEventListener("abort", () => {
        aborts += 1
      })
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            cancellations += 1
          },
          read: async () => {
            reads += 1
            return reads === 1
              ? { done: false as const, value: new Uint8Array([1]) }
              : { done: true as const, value: undefined }
          },
        }),
      })
    }

    const stream = current.context.player_test.request_stream(40)
    const chunk = await stream.next()
    deepEqual(chunk.done, false)
    deepEqual([...chunk.value], [1])
    const end = await stream.next()

    deepEqual(end.done, true)
    deepEqual(
      { aborts, cancellations, reads },
      { aborts: 0, cancellations: 0, reads: 2 },
    )
  },
)

test(
  "a non-OK response aborts and drains its body before retry",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const cancelReleased = Promise.withResolvers<void>()
    const requests: Array<{ signal: AbortSignal; target: string | null }> = []
    let cancelStarted = false
    let abortedBeforeCancel = false

    current.context.fetch = async (url, { signal }) => {
      requests.push({
        signal,
        target: new URL(String(url)).searchParams.get("t"),
      })
      if (requests.length !== 1) return liveResponse(signal)

      return {
        ...mockResponse({
          getReader: () => ({
            cancel: async () => {
              cancelStarted = true
              abortedBeforeCancel = signal.aborted
              await cancelReleased.promise
            },
            read: async () => ({ done: true, value: undefined }),
          }),
        }),
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => cancelStarted || clock.length !== 0)
      await nextTask()
      deepEqual(
        {
          abortedBeforeCancel,
          cancelStarted,
          requests: requests.length,
          retryTimers: clock.length,
        },
        {
          abortedBeforeCancel: true,
          cancelStarted: true,
          requests: 1,
          retryTimers: 0,
        },
      )

      cancelReleased.resolve()
      await eventually(() => clock.length === 1)
      deepEqual(requests.length, 1)
      clock.advance(0)
      await eventually(() => requests.length === 2)
      deepEqual(
        requests.map(({ target }) => target),
        ["40", "40"],
      )
      deepEqual(requests[0]?.signal.aborted, true)
      deepEqual(requests[1]?.signal.aborted, false)
    } finally {
      cancelReleased.resolve()
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

const openPage = async (
  current: Awaited<ReturnType<typeof fixture>>,
  signal: AbortSignal,
  position: number,
) => {
  const page = current.context.player_test.page_reader(signal, position)
  deepEqual(await page.next(), current.context.player_test.PULSE)
  return page
}

const pulsePage = async (
  current: Awaited<ReturnType<typeof fixture>>,
  page: PageReader,
  dispatch: () => void,
) => {
  const pending = page.next()
  dispatch()
  deepEqual(await pending, current.context.player_test.PULSE)
  return page.target
}

const closePage = async (controller: AbortController, page: PageReader) => {
  controller.abort()
  await page.close()
}

const ready = async (
  current: Awaited<ReturnType<typeof fixture>>,
  position = 40,
) => {
  const controller = new AbortController()
  const page = await openPage(current, controller.signal, position)
  current.ranges.push([0, 100])
  current.media.readyState = 1
  await pulsePage(current, page, () => {
    current.media.dispatchEvent(new Event("canplay"))
  })
  await pulsePage(current, page, () => {
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))
    current.media.seeking = false
    current.media.dispatchEvent(new Event("seeked"))
  })
  return { controller, page }
}

const runningPlayback = async (
  current: Awaited<ReturnType<typeof fixture>>,
) => {
  const controller = new AbortController()
  const playback = current.context.player_test.playback_page(controller.signal)
  await eventually(
    () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
  )
  return { controller, playback }
}

test(
  "startup applies its target after metadata without waiting for target bytes",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 40)

    await pulsePage(current, page, () => {
      current.media.dispatchEvent(new Event("timeupdate"))
    })
    deepEqual(current.timeInput.value, "40")

    current.media.readyState = 1
    await pulsePage(current, page, () => {
      current.media.dispatchEvent(new Event("loadedmetadata"))
    })
    deepEqual(current.media.currentTime, 40)
    await closePage(controller, page)
  },
)

test(
  "closing a page reader detaches observers from a live parent",
  options,
  async () => {
    const current = await fixture()
    const parent = new AbortController()
    const page = await openPage(current, parent.signal, 40)
    const calls = current.media.listenerCalls

    await page.close()
    deepEqual(parent.signal.aborted, false)
    current.media.dispatchEvent(new Event("timeupdate"))

    deepEqual(current.media.listenerCalls, calls)
    deepEqual(await page.next(), undefined)
  },
)

test(
  "one observation batch retains its latest synchronous seek",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 40)

    const pending = page.next()
    current.media.error = { code: 3, message: "decode failed" }
    current.media.dispatchEvent(new Event("error"))
    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))

    deepEqual(await pending, current.context.player_test.PULSE)
    deepEqual(page.target.position, 110)
    deepEqual(page.target.restart, true)
    await closePage(controller, page)
  },
)

test(
  "a subtitle error storm retries once without touching media",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    current.context["window"].dispatchEvent(new Event("pageshow"))
    try {
      await eventually(
        () =>
          current.subtitle.sources.length !== 0 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      await new Promise((resolve) => setImmediate(resolve))
      const subtitleRequests = current.subtitle.sources.length
      const mediaBoundary = () => ({
        buffered: current.media.buffered.ranges.map(([start, end]) => [
          start,
          end,
        ]),
        currentTime: current.media.currentTime,
        loads: current.media.loads,
        requests: current.requests.length,
        revoked: current.revoked.length,
        source: current.media.src,
        sources: current.sources.length,
      })
      const beforeError = mediaBoundary()

      for (let event = 0; event < 64; event += 1) {
        current.subtitle.dispatchEvent(new Event("error"))
      }
      await eventually(() => clock.length === 1)

      deepEqual(current.errors.length, 1)
      deepEqual(clock.length, 1)
      deepEqual(mediaBoundary(), beforeError)
      clock.advance(0)
      await eventually(
        () => current.subtitle.sources.length === subtitleRequests + 1,
      )

      deepEqual(current.subtitle.sources.length, subtitleRequests + 1)
      const initial = new URL(
        present(current.subtitle.sources[subtitleRequests - 1]),
      )
      const retried = new URL(
        present(current.subtitle.sources[subtitleRequests]),
      )
      deepEqual(retried.searchParams.get("t"), "0")
      notEqual(
        retried.searchParams.get("request"),
        initial.searchParams.get("request"),
      )
      current.subtitle.dispatchEvent(new Event("load"))
      await new Promise((resolve) => setImmediate(resolve))
      deepEqual(clock.length, 1)
      deepEqual(current.errors.length, 1)
      deepEqual(mediaBoundary(), beforeError)
    } finally {
      current.context["window"].dispatchEvent(new Event("pagehide"))
      clock.dispose()
    }
  },
)

test("a pre-cancelled subtitle owner starts no request", options, async () => {
  const current = await fixture()
  const controller = new AbortController()
  controller.abort()

  await current.context.player_test.play_subtitle(controller.signal)

  deepEqual(current.subtitle.sources, [])
})

test(
  "subtitle cancellation at its retry deadline starts no successor",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const controller = new AbortController()
    const playback = current.context.player_test.play_subtitle(
      controller.signal,
    )
    try {
      await eventually(() => current.subtitle.sources.length === 1)
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => clock.length === 1)

      clock.advance(0)
      controller.abort()
      await playback

      deepEqual(current.subtitle.sources.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "subtitle owner cancellation clears frozen retry and listeners",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    let hidden = false
    try {
      current.context["window"].dispatchEvent(new Event("pageshow"))
      await eventually(
        () =>
          current.subtitle.sources.length !== 0 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => clock.length === 1)
      deepEqual(clock.length, 1)
      const subtitleRequests = current.subtitle.sources.length

      current.context["window"].dispatchEvent(new Event("pagehide"))
      hidden = true
      await eventually(() => clock.cancellations === 1)
      deepEqual(clock.cancellations, 1)
      clock.advance(0)
      await eventually(() => current.media.src === "")
      deepEqual(current.subtitle.sources.length, subtitleRequests)
      const listenerCalls = current.subtitle.listenerCalls
      current.subtitle.dispatchEvent(new Event("error"))
      deepEqual(current.subtitle.listenerCalls, listenerCalls)
      current.subtitle.dispatchEvent(new Event("load"))
      deepEqual(current.subtitle.listenerCalls, listenerCalls)
    } finally {
      if (!hidden) {
        current.context["window"].dispatchEvent(new Event("pagehide"))
      }
      clock.dispose()
    }

    const owned = await fixture()
    const parent = new AbortController()
    const owner = new AbortController()
    const attempt = owned.context.player_test.play_subtitle(
      AbortSignal.any([parent.signal, owner.signal]),
    )
    await new Promise((resolve) => setImmediate(resolve))
    owner.abort()
    await attempt
    deepEqual(parent.signal.aborted, false)
    const ownedCalls = owned.subtitle.listenerCalls
    owned.subtitle.dispatchEvent(new Event("error"))
    owned.subtitle.dispatchEvent(new Event("load"))
    deepEqual(owned.subtitle.listenerCalls, ownedCalls)
  },
)

test(
  "an unexpected subtitle failure cancels and drains its media sibling",
  options,
  async () => {
    const current = await fixture()
    let requestSignal: AbortSignal | undefined = undefined
    current.context.fetch = async (_url, { signal }) => {
      requestSignal = signal
      return liveResponse(signal)
    }
    const clock = frozenClock(current.context)
    const parent = new AbortController()
    const playback = current.context.player_test.playback_page(parent.signal)
    let outcome:
      | { error: unknown; status: "rejected" }
      | { status: "fulfilled" }
      | undefined = undefined
    const observed = playback.then(
      () => {
        outcome = { status: "fulfilled" }
      },
      (error: unknown) => {
        outcome = { error, status: "rejected" }
      },
    )

    try {
      await eventually(
        () =>
          current.subtitle.sources.length !== 0 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      const diagnostic = new Error("subtitle diagnostic failed")
      current.context["console"] = {
        error: () => {
          throw diagnostic
        },
      }
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => outcome !== undefined)

      deepEqual(outcome, { error: diagnostic, status: "rejected" })
      deepEqual(parent.signal.aborted, false)
      deepEqual(present<AbortSignal>(requestSignal).aborted, true)
      deepEqual(current.media.src, "")
      deepEqual(current.media.loads, 1)
      deepEqual(current.revoked.length, 1)
      deepEqual(buffer.usable, false)
      deepEqual(clock.length, 0)

      const mediaCalls = current.media.listenerCalls
      const subtitleCalls = current.subtitle.listenerCalls
      current.media.dispatchEvent(new Event("timeupdate"))
      current.subtitle.dispatchEvent(new Event("error"))
      current.subtitle.dispatchEvent(new Event("load"))
      deepEqual(current.media.listenerCalls, mediaCalls)
      deepEqual(current.subtitle.listenerCalls, subtitleCalls)
    } finally {
      parent.abort()
      await observed
      clock.dispose()
    }
  },
)

test(
  "a user seek supersedes an unacknowledged startup position",
  options,
  async () => {
    const current = await fixture(0)
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 0)
    const initial = page.target

    current.media.currentTime = 37
    current.media.seeking = true
    const sought = await pulsePage(current, page, () => {
      current.media.dispatchEvent(new Event("seeking"))
    })
    notEqual(sought, initial)
    deepEqual(sought.restart, true)
    deepEqual(current.timeInput.value, "37")

    current.ranges.push([0, 10])
    const stale = await pulsePage(current, page, () => {
      current.media.dispatchEvent(new Event("canplay"))
    })
    deepEqual(stale, sought)
    deepEqual(current.media.currentTime, 37)
    await closePage(controller, page)
  },
)

test(
  "a stale owned echo cannot replace a newer batched seek",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 40)
    const initial = page.target

    const change = await pulsePage(current, page, () => {
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.currentTime = 40
      current.media.dispatchEvent(new Event("seeking"))
    })
    notEqual(change, initial)
    deepEqual(
      {
        position: change.position,
        restart: change.restart,
      },
      {
        position: 110,
        restart: true,
      },
    )
    deepEqual(current.timeInput.value, "110")

    const echo = await pulsePage(current, page, () => {
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
    })
    deepEqual(echo, change)
    await closePage(controller, page)
  },
)

test(
  "an internal seek acknowledgement cannot become a user seek",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 40)
    const initial = page.target

    current.media.readyState = 1
    deepEqual(
      await pulsePage(current, page, () => {
        current.media.dispatchEvent(new Event("loadedmetadata"))
      }),
      initial,
    )
    deepEqual(current.media.currentTime, 40)

    const acknowledged = await pulsePage(current, page, () => {
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      current.media.dispatchEvent(new Event("timeupdate"))
    })
    deepEqual(acknowledged, initial)
    deepEqual(acknowledged.position, 40)
    deepEqual(acknowledged.restart, false)
    deepEqual(current.timeInput.value, "40")
    await closePage(controller, page)
  },
)

const synchronousSeekCases = [
  {
    events: ["seeking", "seeked"],
    name: "seeking-seeked",
  },
  {
    events: ["seeking", "timeupdate"],
    name: "seeking-timeupdate",
  },
  {
    events: ["timeupdate", "seeking"],
    name: "timeupdate-seeking",
  },
] as const

for (const { events, name } of synchronousSeekCases) {
  test(
    `an unbuffered seek collapses synchronous ${name} to one seek`,
    options,
    async () => {
      const current = await fixture()
      const { controller, page } = await ready(current)
      const previous = page.target
      current.media.currentTime = 110
      const change = await pulsePage(current, page, () => {
        for (const event of events) {
          if (event === "seeking") {
            current.media.seeking = true
          } else if (event === "seeked") {
            current.media.seeking = false
          }
          current.media.dispatchEvent(new Event(event))
        }
      })

      notEqual(change, previous)
      deepEqual(change.restart, true)
      deepEqual(change.position, 110)
      deepEqual(current.timeInput.value, "110")
      await closePage(controller, page)
    },
  )
}

const bufferedSeekCases = [
  { name: "contained", range: [70, 100], target: 70 },
  { name: "adjacent", range: [70.05, 100], target: 70.05 },
] as const

for (const { name, range, target } of bufferedSeekCases) {
  const article = name === "adjacent" ? "an" : "a"
  test(
    `${article} ${name} buffered seek aligns without restarting`,
    options,
    async () => {
      const current = await fixture()
      const { controller, page } = await ready(current)
      const previous = page.target
      current.ranges.splice(0, current.ranges.length, [range[0], range[1]])
      current.media.currentTime = 70
      const change = await pulsePage(current, page, () => {
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
      })

      notEqual(change, previous)
      deepEqual(change.position, target)
      deepEqual(change.restart, false)
      deepEqual(current.timeInput.value, String(Math.floor(target)))
      await closePage(controller, page)
    },
  )
}

test("page progress persists only playable positions", options, async () => {
  const current = await fixture()
  const { controller, page } = await ready(current)

  current.media.currentTime = 110
  await pulsePage(current, page, () => {
    current.media.dispatchEvent(new Event("timeupdate"))
  })
  deepEqual(current.timeInput.value, "40")

  current.ranges.push([110, 120])
  current.media.currentTime = 111
  await pulsePage(current, page, () => {
    current.media.dispatchEvent(new Event("timeupdate"))
  })
  deepEqual(current.timeInput.value, "111")
  await closePage(controller, page)
})

test("ended resets the resume position", options, async () => {
  const current = await fixture()
  const { controller, page } = await ready(current)
  current.media.currentTime = 200
  current.media.ended = true
  await pulsePage(current, page, () => {
    current.media.dispatchEvent(new Event("ended"))
  })
  deepEqual(current.timeInput.value, "0")
  await closePage(controller, page)
})

test("exact-end startup requests a playable position", options, async () => {
  const current = await fixture(200)
  const controller = new AbortController()
  const playback = current.context.player_test.playback_page(controller.signal)
  try {
    await eventually(() => current.requests.length === 1)
    deepEqual(
      new URL(present(current.requests[0])).searchParams.get("t"),
      "199",
    )
    deepEqual(current.media.currentTime, 199)
  } finally {
    controller.abort()
    await playback
  }
})

test(
  "an expected native media abort does not rebuild playback",
  options,
  async () => {
    const current = await fixture()
    let requestSignal: AbortSignal | undefined = undefined
    current.context.fetch = async (_url, { signal }) => {
      requestSignal = signal
      return liveResponse(signal)
    }
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.error = {
        code: current.context.MediaError.MEDIA_ERR_ABORTED,
      }
      current.media.dispatchEvent(new Event("error"))
      for (let turn = 0; turn < 4; turn += 1) {
        await nextTask()
      }

      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 0)
      deepEqual(present<AbortSignal>(requestSignal).aborted, false)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "an owned seek remains owned until its native acknowledgement",
  options,
  async () => {
    const current = await fixture(110)
    const controller = new AbortController()
    const page = await openPage(current, controller.signal, 110)
    const owned = page.target

    page.seek()
    current.media.readyState = current.media.HAVE_METADATA
    current.media.buffered.ranges = [[110, 120]]
    deepEqual(
      await pulsePage(current, page, () => {
        current.media.dispatchEvent(new Event("loadedmetadata"))
      }),
      owned,
    )

    current.media.buffered.ranges = []
    deepEqual(
      await pulsePage(current, page, () => {
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
        current.media.seeking = false
        current.media.dispatchEvent(new Event("seeked"))
      }),
      owned,
    )

    const later = await pulsePage(current, page, () => {
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
    })
    notEqual(later, owned)
    deepEqual(later.restart, true)

    await closePage(controller, page)
  },
)

test(
  "page state retains a seek following an error in one synchronous batch",
  options,
  async () => {
    const current = await fixture()
    const { controller, page } = await ready(current)
    const previous = page.target
    const failure = { code: 3, message: "decode failed" }

    const change = await pulsePage(current, page, () => {
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
    })
    notEqual(change, previous)
    deepEqual(change.position, 110)
    deepEqual(change.restart, true)
    await closePage(controller, page)
  },
)

test(
  "a media failure storm produces one diagnostic and one same-target reset",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const failure = { code: 3, message: "decode failed" }
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      current.media.dispatchEvent(new Event("timeupdate"))
      current.media.dispatchEvent(new Event("progress"))

      await eventually(
        () => current.sources.length === 2 && current.requests.length === 2,
      )
      deepEqual(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "40",
      )
      deepEqual(current.sources.length, 2)
      deepEqual(current.errors.length, 1)
      deepEqual(current.errors[0]?.[0], failure)
      deepEqual(current.media.loads, 0)
      deepEqual(
        current.requests.some(
          (url) => new URL(url).searchParams.get("t") === "0",
        ),
        false,
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

const synchronousFailureSeekCases = [
  {
    events: ["error", "seeking"],
    name: "error-seeking",
  },
  {
    events: ["seeking", "error"],
    name: "seeking-error",
  },
] as const

for (const { events, name } of synchronousFailureSeekCases) {
  test(
    `a simultaneous media error and unbuffered seek rebuilds once for ${name}`,
    options,
    async () => {
      const current = await fixture()
      const clock = frozenClock(current.context)
      const controller = new AbortController()
      const playback = current.context.player_test.playback_page(
        controller.signal,
      )
      try {
        await eventually(
          () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
        )
        const failure = { code: 3, message: "decode failed" }
        for (const event of events) {
          if (event === "error") {
            current.media.error = failure
          } else {
            current.media.currentTime = 110
            current.media.seeking = true
          }
          current.media.dispatchEvent(new Event(event))
        }

        await eventually(
          () =>
            current.sources.length === 2 &&
            current.requests.length === 2 &&
            current.timeInput.value === "110",
        )
        deepEqual(
          {
            callbacks: clock.callbacks,
            diagnostics: current.errors.map(([error]) => error),
            loads: current.media.loads,
            requests: current.requests.map((url) =>
              new URL(url).searchParams.get("t"),
            ),
            sources: current.sources.length,
            target: current.timeInput.value,
            timers: clock.length,
          },
          {
            callbacks: 0,
            diagnostics: [failure],
            loads: 0,
            requests: ["40", "110"],
            sources: 2,
            target: "110",
            timers: 0,
          },
        )
      } finally {
        controller.abort()
        await playback
        clock.dispose()
      }
    },
  )
}

const controlledPage = (position: number, pulse: symbol) => {
  let target = { position, restart: false, started: false }
  let closed = false
  let changed = Promise.withResolvers<symbol | undefined>()
  const page: SourcePage = {
    next: async <T,>(work?: Promise<T>) => {
      const selected = await Promise.race([
        changed.promise,
        ...(work ? [work] : []),
      ])
      if (selected === pulse) {
        changed = Promise.withResolvers<symbol | undefined>()
        if (closed) changed.resolve(undefined)
      }
      return selected
    },
    get target() {
      return target
    },
    take_error: () => undefined,
  }
  const notify = () => changed.resolve(pulse)
  return {
    change: (position: number): void => {
      target = {
        position,
        restart: true,
        started: true,
      }
      notify()
    },
    close: (): void => {
      closed = true
      changed.resolve(undefined)
    },
    page,
    pulse: notify,
  }
}

test(
  "high water stops an eager transport from growing while paused",
  options,
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    const firstAppend = Promise.withResolvers<void>()
    const queued: Uint8Array[] = []
    let pendingRead:
      ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined =
      undefined
    let requests = 0
    let aborts = 0
    let cancellations = 0
    let completed = false
    let producing = true
    let produced = 0
    const stop = () => {
      producing = false
      pendingRead?.({ done: true, value: undefined })
      pendingRead = undefined
    }
    const produce = () => {
      if (!producing) {
        return
      }
      produced += 1
      const chunk = new Uint8Array([produced])
      const resolve = pendingRead
      if (resolve) {
        pendingRead = undefined
        resolve({ done: false, value: chunk })
      } else {
        queued.push(chunk)
      }
      setImmediate(produce)
    }
    current.context.fetch = async (_url, { signal }) => {
      requests += 1
      signal.addEventListener(
        "abort",
        () => {
          aborts += 1
          stop()
        },
        { once: true },
      )
      setImmediate(produce)
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            cancellations += 1
            stop()
          },
          read: async () => {
            const chunk = queued.shift()
            if (chunk) {
              return { done: false as const, value: chunk }
            }
            if (!producing) {
              completed = true
              return { done: true as const, value: undefined }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (resolve) => {
                pendingRead = resolve
              },
            )
          },
        }),
      })
    }
    const page = controlledPage(40, current.context.player_test.PULSE)
    let appends = 0
    const buffer = {
      next: async (operation: MseOperation) => {
        if (operation instanceof Uint8Array) {
          appends += 1
          current.media.buffered.ranges = [[40, 100]]
          firstAppend.resolve()
        }
        return { done: false as const, value: undefined }
      },
    }
    const playback = current.context.player_test.play_source(
      buffer,
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await firstAppend.promise
      await eventually(() => completed || aborts > 0 || cancellations > 0)
      deepEqual(requests, 1)
      deepEqual(appends, 1)

      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const settled = produced
      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      deepEqual(produced, settled)
      assert(completed || aborts > 0 || cancellations > 0)
    } finally {
      producing = false
      page.close()
      await playback
    }
  },
)

const unrelatedHighWaterCases = [
  {
    name: "an unrelated high-water range cannot cancel a parser-warmup target request",
    ranges: [[40, 100]],
  },
  {
    name: "an unrelated high-water range cannot cap partial target progress",
    ranges: [
      [40, 100],
      [110, 120],
    ],
  },
] as const

for (const { name, ranges } of unrelatedHighWaterCases) {
  test(name, options, async () => {
    const current = await fixture()
    current.media.currentTime = 110
    const requests: Array<{ signal: AbortSignal; time: string | null }> = []
    let reads = 0
    let cancellations = 0
    current.context.fetch = async (url, { signal }) => {
      requests.push({
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      })
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            cancellations += 1
          },
          read: async () => {
            reads += 1
            if (reads === 1) {
              current.media.currentTime = 40
              current.media.buffered.ranges = ranges.map(([start, end]) => [
                start,
                end,
              ])
              return { done: false, value: new Uint8Array([1]) }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (resolve) => {
                signal.addEventListener(
                  "abort",
                  () => resolve({ done: true, value: undefined }),
                  { once: true },
                )
              },
            )
          },
        }),
      })
    }
    const page = controlledPage(110, current.context.player_test.PULSE)
    const playback = current.context.player_test.play_source(
      { next: async () => ({ done: false as const, value: undefined }) },
      { error: () => {}, progress: () => {} },
      page.page,
    )

    try {
      await eventually(() => reads === 2)
      deepEqual(
        requests.map(({ time }) => time),
        ["110"],
      )
      deepEqual(present(requests[0]).signal.aborted, false)
      deepEqual(cancellations, 0)
      deepEqual(current.media.buffered.ranges, ranges)
    } finally {
      page.close()
      await playback
    }
  })
}

test(
  "owner cancellation aborts and drains a pending fetch",
  options,
  async () => {
    const current = await fixture()
    const response = Promise.withResolvers<MockResponse>()
    let requestSignal: AbortSignal | undefined = undefined
    current.context.fetch = async (_url, { signal }) => {
      requestSignal = signal
      return response.promise
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    await eventually(() => requestSignal !== undefined)
    let settled = false
    void playback.then(() => {
      settled = true
    })
    controller.abort()
    await eventually(() => present(requestSignal).aborted)
    await nextTask()
    deepEqual(settled, false)

    response.reject(new DOMException("The operation was aborted", "AbortError"))
    await playback
    deepEqual(current.media.loads, 1)
    deepEqual(current.media.src, "")
    deepEqual(current.revoked.length, 1)
  },
)

const acquisitionPolicyCases = [
  {
    expected: ["40", "100"],
    name: "a suspended same-frontier seek resumes one request",
    range: [40, 100],
    target: 100,
  },
  {
    expected: ["40", "110"],
    name: "a different target drains one active frontier",
    range: [40, 50],
    target: 110,
  },
] as const

for (const { expected, name, range, target } of acquisitionPolicyCases) {
  test(name, options, async () => {
    const current = await fixture()
    const firstChunk =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const page = controlledPage(40, current.context.player_test.PULSE)
    const requests: Array<{
      cancellations: number
      reads: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        reads: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
          },
          read: async () => {
            request.reads += 1
            if (index === 0 && request.reads === 1) {
              return firstChunk.promise
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }
    const buffer = {
      next: async (operation: MseOperation) => {
        if (operation instanceof Uint8Array) {
          current.media.buffered.ranges = [[range[0], range[1]]]
        }
        return { done: false as const, value: undefined }
      },
    }
    current.media.currentTime = 40
    const playback = current.context.player_test.play_source(
      buffer,
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => requests.length === 1)
      firstChunk.resolve({ done: false, value: new Uint8Array([1]) })
      await eventually(() =>
        range[1] === 100
          ? requests[0]?.cancellations === 1
          : requests[0]?.reads === 2,
      )

      current.media.currentTime = target
      page.change(target)
      await eventually(() => requests.length === 2)
      await nextTask()

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          cancellations: requests.map(({ cancellations }) => cancellations),
          requests: requests.map(({ time }) => time),
        },
        {
          aborted: [true, false],
          cancellations: [1, 0],
          requests: expected,
        },
      )
    } finally {
      page.close()
      await playback
    }
  })
}

const pendingFetchSeekCases = [
  {
    aborted: false,
    expected: ["40"],
    name: "a same-target seek retains a pending fetch",
    target: 40,
  },
  {
    aborted: true,
    expected: ["40", "110"],
    name: "a different target waits for its pending fetch to retire",
    target: 110,
  },
] as const

for (const { aborted, expected, name, target } of pendingFetchSeekCases) {
  test(name, options, async () => {
    const current = await fixture()
    const held = Promise.withResolvers<MockResponse>()
    const requests: Array<{
      abortedAtFetch: boolean
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const index =
        requests.push({
          abortedAtFetch: signal.aborted,
          signal,
          time: new URL(String(url)).searchParams.get("t"),
        }) - 1
      return index === 0 ? held.promise : liveResponse(signal)
    }
    const page = controlledPage(40, current.context.player_test.PULSE)
    const playback = current.context.player_test.play_source(
      {
        next: async () => ({ done: false as const, value: undefined }),
      },
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => requests.length === 1)
      page.change(target)
      await eventually(() => requests[0]?.signal.aborted === aborted)
      await nextTask()
      deepEqual(
        requests.map(({ time }) => time),
        ["40"],
      )

      if (aborted) {
        held.reject(new DOMException("The operation was aborted", "AbortError"))
        await eventually(() => requests.length === 2)
      }
      await nextTask()
      deepEqual(
        requests.map(({ abortedAtFetch, signal, time }) => ({
          aborted: signal.aborted,
          abortedAtFetch,
          time,
        })),
        expected.map((time, index) => ({
          aborted: aborted && index === 0,
          abortedAtFetch: false,
          time,
        })),
      )
    } finally {
      held.reject(new DOMException("The operation was aborted", "AbortError"))
      page.close()
      await playback
    }
  })
}

test(
  "an unbuffered seek keeps its retry interruption after later progress",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const page = controlledPage(40, current.context.player_test.PULSE)
    const requests: string[] = []
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length === 1) throw new Error("source request failed")
      return liveResponse(signal)
    }
    const playback = current.context.player_test.play_source(
      {
        next: async () => ({ done: false as const, value: undefined }),
      },
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => clock.length === 1)
      page.change(40)
      current.media.buffered.ranges = [[40, 41]]
      await eventually(() => requests.length === 2)

      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40"],
      )
      deepEqual(clock.callbacks, 0)
      deepEqual(clock.cancellations, 1)
    } finally {
      page.close()
      await playback
      clock.dispose()
    }
  },
)

const enteredAppendSeekCases = [
  {
    expected: ["40"],
    name: "a seek to an append's committed frontier keeps its reader",
    targets: [50],
  },
  {
    expected: ["40"],
    name: "a held append retains its reader for the latest committed target",
    targets: [110, 50],
  },
  {
    expected: ["40", "110"],
    name: "a held append restarts only at its latest different target",
    targets: [50, 110],
  },
] as const

for (const { expected, name, targets } of enteredAppendSeekCases) {
  test(name, options, async () => {
    const current = await fixture()
    const requests: Array<{
      cancellations: number
      reads: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        reads: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      requests.push(request)
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
          },
          read: async () => {
            request.reads += 1
            if (request.reads === 1) {
              return { done: false, value: new Uint8Array([1]) }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }

    const { buffer, controller, opened } = await open_mse(current)
    const page = controlledPage(40, current.context.player_test.PULSE)
    opened.holdUpdate = true
    const playback = current.context.player_test.play_source(
      buffer,
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => opened.updating)
      for (const target of targets) {
        page.change(target)
      }
      await nextTask()
      present(opened.releaseUpdate)()
      await eventually(() => opened.buffered.end(0) === 50)
      if (expected.length === 2) {
        await eventually(() => requests.length >= 2)
      }
      await nextTask()

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          cancellations: requests.map(({ cancellations }) => cancellations),
          requests: requests.map(({ time }) => time),
        },
        {
          aborted: expected.length === 1 ? [false] : [true, false],
          cancellations: expected.length === 1 ? [0] : [1, 0],
          requests: expected,
        },
      )
    } finally {
      page.close()
      controller.abort()
      if (opened.updating) {
        present(opened.releaseUpdate)()
      }
      await playback
      await buffer.return(undefined)
    }
  })
}

test(
  "an aborted read result cannot enter the append section",
  options,
  async () => {
    const current = await fixture()
    const queued = Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const requests: Array<{
      cancellations: number
      reads: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        reads: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
          },
          read: () => {
            request.reads += 1
            if (index === 0 && request.reads === 1) {
              return queued.promise
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }
    let appends = 0
    const buffer = {
      next: async (operation: MseOperation) => {
        if (operation instanceof Uint8Array) {
          appends += 1
        }
        return { done: false as const, value: undefined }
      },
    }
    const page = controlledPage(40, current.context.player_test.PULSE)
    const playback = current.context.player_test.play_source(
      buffer,
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => requests.length === 1)
      page.change(110)
      await eventually(() => present(requests[0]).signal.aborted)
      queued.resolve({ done: false, value: new Uint8Array([1]) })
      await eventually(() => requests.length === 2)

      deepEqual(
        {
          appends,
          cancellations: requests.map(({ cancellations }) => cancellations),
          requests: requests.map(({ time }) => time),
        },
        {
          appends: 0,
          cancellations: [1, 0],
          requests: ["40", "110"],
        },
      )
    } finally {
      page.close()
      await playback
    }
  },
)

test(
  "a seek to an active low-water frontier keeps its request",
  options,
  async () => {
    const current = await fixture()
    const firstChunk =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const requests: Array<{
      cancellations: number
      reads: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        reads: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
          },
          read: async () => {
            request.reads += 1
            if (index === 0 && request.reads === 1) {
              return firstChunk.promise
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => current.sources[0]?.sourceBuffers.length === 1)
      const buffer = present(current.sources[0]?.sourceBuffers[0])
      buffer.appendBuffer = () => {
        buffer.updating = true
        buffer.appendState = "parsing"
        queueMicrotask(() => {
          buffer.buffered.ranges = [[40, 100]]
          current.media.buffered.ranges = [[40, 100]]
          if (current.media.readyState === 0) {
            current.media.readyState = current.media.HAVE_METADATA
            current.media.dispatchEvent(new Event("loadedmetadata"))
          }
          buffer.updating = false
          buffer.dispatchEvent(new Event("updateend"))
        })
      }
      firstChunk.resolve({ done: false, value: new Uint8Array([1]) })
      await eventually(
        () =>
          requests[0]?.cancellations === 1 &&
          current.media.buffered.ranges[0]?.[1] === 100,
      )
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await nextTask()

      current.media.currentTime = 60
      current.media.dispatchEvent(new Event("timeupdate"))
      await eventually(() => requests.length === 2 && requests[1]?.reads === 1)

      current.media.currentTime = 100
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()
      await nextTask()

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          cancellations: requests.map(({ cancellations }) => cancellations),
          requests: requests.map(({ time }) => time),
        },
        {
          aborted: [true, false],
          cancellations: [1, 0],
          requests: ["40", "100"],
        },
      )
      deepEqual(current.sources.length, 1)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a seek during high-water teardown cannot start an aborted frontier",
  options,
  async () => {
    const current = await fixture()
    const firstChunk =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const cancellationStarted = Promise.withResolvers<void>()
    const cancellationReleased = Promise.withResolvers<void>()
    const requests: Array<{
      abortedAtFetch: boolean
      cancellations: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        abortedAtFetch: signal.aborted,
        cancellations: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
            if (index === 0) {
              cancellationStarted.resolve()
              await cancellationReleased.promise
            }
          },
          read: async () => {
            if (index === 0) {
              return firstChunk.promise
            }
            if (signal.aborted) {
              return { done: true, value: undefined }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                signal.addEventListener(
                  "abort",
                  () =>
                    reject(
                      new DOMException(
                        "The operation was aborted",
                        "AbortError",
                      ),
                    ),
                  { once: true },
                )
              },
            )
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => current.sources[0]?.sourceBuffers.length === 1)
      const buffer = present(current.sources[0]?.sourceBuffers[0])
      buffer.appendBuffer = () => {
        buffer.updating = true
        buffer.appendState = "parsing"
        queueMicrotask(() => {
          buffer.buffered.ranges = [[40, 100]]
          current.media.buffered.ranges = [[40, 100]]
          if (current.media.readyState === 0) {
            current.media.readyState = current.media.HAVE_METADATA
            current.media.dispatchEvent(new Event("loadedmetadata"))
          }
          buffer.updating = false
          buffer.dispatchEvent(new Event("updateend"))
        })
      }
      firstChunk.resolve({ done: false, value: new Uint8Array([1]) })
      await cancellationStarted.promise

      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()
      deepEqual(requests.length, 1)
      cancellationReleased.resolve()

      await eventually(() =>
        requests.some(
          ({ abortedAtFetch, time }) => time === "110" && !abortedAtFetch,
        ),
      )
      await nextTask()

      deepEqual(
        requests.map(({ abortedAtFetch, time }) => ({ abortedAtFetch, time })),
        [
          { abortedAtFetch: false, time: "40" },
          { abortedAtFetch: false, time: "110" },
        ],
      )
      deepEqual(present(requests.at(-1)).signal.aborted, false)
      deepEqual(current.sources.length, 1)
    } finally {
      cancellationReleased.resolve()
      controller.abort()
      await playback
    }
  },
)

const partialFailureCases = [
  {
    failure: "request failed after partial progress",
    name: "a partial request failure retries acquisition from the buffered frontier",
    playhead: 40,
  },
  {
    failure: "request failed at the buffered frontier",
    name: "a stalled playhead retains its exact buffered frontier for retry",
    playhead: 55,
  },
  {
    failure: "request failed beside an unrelated playhead range",
    name: "acquisition progress uses its own buffered range",
    playhead: 5,
  },
] as const

for (const { failure, name, playhead } of partialFailureCases) {
  test(name, options, async () => {
    const current = await fixture()
    const failed = Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const retried = Promise.withResolvers<string>()
    const clock = frozenClock(current.context)
    const requests: string[] = []
    let firstReads = 0
    current.context.fetch = async (url, { signal }) => {
      const request = String(url)
      const index = requests.push(request) - 1
      if (index === 1) {
        retried.resolve(request)
      }
      return mockResponse({
        getReader: () => ({
          cancel: async () => {},
          read: async () => {
            if (index === 0) {
              firstReads += 1
              return firstReads === 1
                ? {
                    done: false as const,
                    value: new Uint8Array([1]),
                  }
                : failed.promise
            }
            if (signal.aborted) {
              return { done: true as const, value: undefined }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (resolve) => {
                signal.addEventListener(
                  "abort",
                  () => resolve({ done: true, value: undefined }),
                  { once: true },
                )
              },
            )
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      const ranges: Range[] =
        playhead === 5
          ? [
              [0, 10],
              [40, 55],
            ]
          : [[40, 55]]
      buffer.buffered.ranges = ranges
      current.media.buffered.ranges = ranges
      await eventually(() => current.media.currentTime === 40)
      current.media.currentTime = playhead

      failed.reject(new Error(failure))
      await eventually(() => clock.length === 1)
      clock.advance(0)
      const request = new URL(await retried.promise)

      deepEqual(
        {
          acquisition: request.searchParams.get("t"),
          offset: buffer.timestampOffset,
          playhead: current.media.currentTime,
          targetInput: current.timeInput.value,
        },
        {
          acquisition: "55",
          offset: 55,
          playhead,
          targetInput: "40",
        },
      )
      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  })
}

test(
  "a final chunk canceled at high water gets one EOF frontier probe",
  options,
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    const requests: string[] = []
    let firstAborts = 0
    let firstCancellations = 0
    let firstReads = 0
    current.context.fetch = async (url, { signal }) => {
      const request = String(url)
      const index = requests.push(request) - 1
      signal.addEventListener(
        "abort",
        () => {
          if (index === 0) {
            firstAborts += 1
          }
        },
        { once: true },
      )
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            if (index === 0) {
              firstCancellations += 1
            }
          },
          read: async () => {
            if (index === 0) {
              firstReads += 1
              return firstReads === 1
                ? {
                    done: false as const,
                    value: new Uint8Array([1]),
                  }
                : { done: true as const, value: undefined }
            }
            return { done: true as const, value: undefined }
          },
        }),
      })
    }

    const page = controlledPage(40, current.context.player_test.PULSE)
    const operations: MseOperation[] = []
    let ends = 0
    const buffer = {
      next: async (operation: MseOperation) => {
        operations.push(operation)
        if (operation === "end") {
          ends += 1
        } else if (operation instanceof Uint8Array) {
          current.media.buffered.ranges = [[40, 100]]
        }
        return { done: false as const, value: undefined }
      },
    }
    const playback = current.context.player_test.play_source(
      buffer,
      { error: () => {}, progress: () => {} },
      page.page,
    )
    try {
      await eventually(() => firstAborts > 0 || firstCancellations > 0)
      deepEqual(firstReads, 1)
      assert(firstAborts > 0 || firstCancellations > 0)

      current.media.currentTime = 60
      page.pulse()
      await eventually(() => ends === 1)

      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "100"],
      )
      deepEqual(
        operations.filter((operation) => typeof operation === "number"),
        [40, 100],
      )
      deepEqual(firstReads, 1)
      deepEqual(ends, 1)
    } finally {
      page.close()
      await playback
    }
  },
)

test(
  "append evicts media more than thirty seconds behind",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    current.media.currentTime = 100
    await buffer.next(new Uint8Array([2]))
    deepEqual(opened.removes, [[0, 70]])

    controller.abort()
    await buffer.return(undefined)
  },
)

test(
  "a new stream epoch aborts an incomplete parser before changing offset",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    deepEqual(opened.updating, false)
    deepEqual(opened.appendState, "parsing")
    deepEqual((await buffer.next(30)).done, false)
    deepEqual(opened.aborts, 1)
    deepEqual(opened.appendState, "waiting")
    deepEqual(opened.timestampOffset, 30)
    deepEqual(current.sources.length, 1)
    deepEqual(current.media.loads, 0)

    controller.abort()
    await buffer.return(undefined)
  },
)

test(
  "a seek reopens an ended MediaSource without exposing native zero",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))
    deepEqual((await buffer.next("end")).done, false)

    const source = current.media.src
    current.media.currentTime = 30
    deepEqual((await buffer.next(30)).done, false)
    deepEqual(opened.aborts, 1)
    deepEqual(opened.removes, [[20, 20.001]])
    deepEqual(current.media.src, source)
    deepEqual(current.media.currentTime, 30)
    deepEqual(current.media.loads, 0)
    deepEqual(current.revoked.length, 0)

    controller.abort()
    await buffer.return(undefined)
  },
)

test(
  "an entered SourceBuffer mutation drains before lifetime teardown",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)
    await buffer.next(10)

    opened.holdUpdate = true
    const appending = buffer.next(new Uint8Array([1]))
    await eventually(() => opened.updating)

    controller.abort()
    let closed = false
    const closing = buffer.return(undefined).then(() => {
      closed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    deepEqual(closed, false)

    present(opened.releaseUpdate)()
    await appending
    await closing
  },
)

test(
  "an asynchronous SourceBuffer error closes the entered mutation",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)

    try {
      const entered = Promise.withResolvers<void>()
      opened.appendBuffer = () => {
        opened.updating = true
        opened.appendState = "parsing"
        entered.resolve()
      }

      await buffer.next(40)
      const appending = buffer.next(new Uint8Array([1]))
      await entered.promise
      const later = buffer.next(80)
      const failure = new Event("error")
      opened.usable = false
      opened.dispatchEvent(failure)

      await rejects(appending, (error) => error === failure)
      deepEqual((await later).done, true)
      deepEqual(opened.timestampOffset, 40)
      deepEqual(opened.aborts, 0)
    } finally {
      controller.abort()
      await buffer.return(undefined)
    }
  },
)

test(
  "one retiring failure cannot poison its scrub replacement",
  options,
  async () => {
    const current = await fixture()
    const chunk = Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const retiringFailure = { code: 3, message: "retiring MSE failed" }
    const requests: Array<{ signal: AbortSignal; time: string | null }> = []
    current.context.fetch = async (url, { signal }) => {
      const index =
        requests.push({
          signal,
          time: new URL(String(url)).searchParams.get("t"),
        }) - 1
      return index === 0
        ? mockResponse({
            getReader: () => ({
              cancel: async () => {
                current.media.error = retiringFailure
                current.media.dispatchEvent(new Event("error"))
              },
              read: async () => chunk.promise,
            }),
          })
        : liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => current.sources[0]?.sourceBuffers.length === 1)
      const buffer = present(current.sources[0]?.sourceBuffers[0])
      const entered = Promise.withResolvers<void>()
      buffer.appendBuffer = () => {
        buffer.updating = true
        buffer.appendState = "parsing"
        entered.resolve()
      }
      chunk.resolve({ done: false, value: new Uint8Array([1]) })
      await entered.promise

      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      buffer.dispatchEvent(new Event("error"))

      await eventually(
        () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )
      await nextTask()
      deepEqual(current.sources.length, 2)
      deepEqual(
        requests.map(({ time }) => time),
        ["40", "110"],
      )
      deepEqual(
        current.errors.map(([error]) => error),
        [retiringFailure],
      )

      const replacementFailure = { code: 3, message: "replacement failed" }
      current.media.error = replacementFailure
      current.media.dispatchEvent(new Event("error"))
      await eventually(
        () => current.sources.length === 3 && requests.length === 3,
      )
      deepEqual(
        requests.map(({ time }) => time),
        ["40", "110", "110"],
      )
      deepEqual(
        current.errors.map(([error]) => error),
        [retiringFailure, replacementFailure],
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a stale empty media error cannot retire its replacement request",
  options,
  async () => {
    const current = await fixture()
    const requests: Array<{ signal: AbortSignal; time: string | null }> = []
    current.context.fetch = async (url, { signal }) => {
      requests.push({
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      })
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const failure = { code: 3, message: "initial media failure" }
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      await eventually(
        () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )

      deepEqual(current.media.error, null)
      current.media.dispatchEvent(new Event("error"))
      for (let turn = 0; turn < 4; turn += 1) {
        await nextTask()
      }

      deepEqual(current.sources.length, 2)
      deepEqual(
        requests.map(({ time }) => time),
        ["40", "40"],
      )
      deepEqual(requests[1]?.signal.aborted, false)
      deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a queued SourceBuffer epoch does not enter after lifetime cancellation",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, opened } = await open_mse(current)
    await buffer.next(10)

    opened.holdUpdate = true
    const appending = buffer.next(new Uint8Array([1]))
    await eventually(() => opened.updating)

    const offsetting = buffer.next(30)
    controller.abort()
    let closed = false
    const closing = buffer.return(undefined).then(() => {
      closed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    deepEqual(closed, false)
    deepEqual(opened.timestampOffset, 10)
    deepEqual(opened.aborts, 0)

    present(opened.releaseUpdate)()
    deepEqual((await appending).done, false)
    await offsetting
    await closing

    deepEqual(opened.timestampOffset, 10)
    deepEqual(opened.aborts, 0)
  },
)

test(
  "a resolved seek is consumed by its simultaneous media-failure rebuild",
  options,
  async () => {
    const current = await fixture()
    current.sourceOpen.hold = true
    const requests: Array<{ signal: AbortSignal; time: string | null }> = []
    current.context.fetch = async (url, { signal }) => {
      requests.push({
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      })
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () =>
          current.sources.length === 1 &&
          current.sourceOpen.pending.length === 1,
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()

      const failure = { code: 3, message: "decode failed during setup" }
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      current.sourceOpen.hold = false
      current.sourceOpen.release()
      for (let turn = 0; turn < 4; turn += 1) {
        await nextTask()
      }

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          diagnostics: current.errors.map(([error]) => error),
          requests: requests.map(({ time }) => time),
          sources: current.sources.length,
          target: current.timeInput.value,
        },
        {
          aborted: [false],
          diagnostics: [failure],
          requests: ["110"],
          sources: 2,
          target: "110",
        },
      )
    } finally {
      controller.abort()
      while (current.sourceOpen.pending.length) {
        current.sourceOpen.release()
      }
      await playback
    }
  },
)

test(
  "a retry deadline cannot outrun its simultaneous same-target seek",
  options,
  async () => {
    const current = await fixture(110)
    const clock = frozenClock(current.context)
    const firstFailure =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const requests: Array<{
      cancellations: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
          },
          read: async () => {
            if (index === 0) {
              return firstFailure.promise
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => requests.length === 1)
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await nextTask()

      firstFailure.reject(new Error("source request failed"))
      await eventually(() => clock.length === 1)
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      clock.advance(0)
      for (let turn = 0; turn < 4; turn += 1) {
        await nextTask()
      }

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          callbacks: clock.callbacks,
          cancellations: requests.map(({ cancellations }) => cancellations),
          diagnostics: current.errors.length,
          requests: requests.map(({ time }) => time),
          sources: current.sources.length,
        },
        {
          aborted: [true, false],
          callbacks: 1,
          cancellations: [1, 0],
          diagnostics: 1,
          requests: ["110", "110"],
          sources: 1,
        },
      )
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a retiring acquisition failure rebuilds before its successor starts",
  options,
  async () => {
    const current = await fixture()
    const retiredFailure = { code: 3, message: "retired media failure" }
    const requests: Array<{
      cancellations: number
      signal: AbortSignal
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      let reads = 0
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
            if (index === 0) {
              current.media.error = retiredFailure
              current.media.dispatchEvent(new Event("error"))
            }
          },
          read: async () => {
            reads += 1
            if (index === 0 && reads === 1) {
              return { done: false, value: new Uint8Array([1]) }
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(() => requests.length >= 2)
      for (let turn = 0; turn < 4; turn += 1) {
        await nextTask()
      }

      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          cancellations: requests.map(({ cancellations }) => cancellations),
          diagnostics: current.errors.length,
          requests: requests.map(({ time }) => time),
          sources: current.sources.length,
        },
        {
          aborted: [true, false],
          cancellations: [1, 0],
          diagnostics: 1,
          requests: ["40", "110"],
          sources: 2,
        },
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

const replacementEchoCases = [
  {
    name: "replacement echo before target cancellation stays coalesced",
    phase: "before-cancel",
  },
  {
    name: "replacement echo during target cancellation stays coalesced",
    phase: "during-cancel",
  },
  {
    name: "an owned replacement seek cannot restart its target request",
    phase: "before-sourceopen",
  },
  {
    name: "replacement progress cannot release a delayed owned seek",
    phase: "after-read",
  },
] as const

for (const { name, phase } of replacementEchoCases) {
  test(name, options, async () => {
    const current = await fixture()
    const failedChunk =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const cancellationStarted = Promise.withResolvers<void>()
    const cancellationReleased = Promise.withResolvers<void>()
    const requests: Array<{
      cancellations: number
      reads: number
      signal: AbortSignal
      source: string
      time: string | null
    }> = []
    current.context.fetch = async (url, { signal }) => {
      const request = {
        cancellations: 0,
        reads: 0,
        signal,
        source: current.media.src,
        time: new URL(String(url)).searchParams.get("t"),
      }
      const index = requests.push(request) - 1
      return mockResponse({
        getReader: () => ({
          cancel: async () => {
            request.cancellations += 1
            if (index === 1) {
              cancellationStarted.resolve()
              if (phase === "during-cancel") {
                await cancellationReleased.promise
              }
            }
          },
          read: async () => {
            request.reads += 1
            if (request.reads === 1) {
              return { done: false, value: new Uint8Array([1]) }
            }
            if (index === 1) {
              return failedChunk.promise
            }
            return new Promise<ReadableStreamReadResult<Uint8Array>>(
              (_resolve, reject) => {
                const aborted = () =>
                  reject(
                    new DOMException("The operation was aborted", "AbortError"),
                  )
                signal.addEventListener("abort", aborted, { once: true })
                if (signal.aborted) {
                  aborted()
                }
              },
            )
          },
        }),
      })
    }

    const echo = (): void => {
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
    }
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(
        () =>
          requests.length === 2 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.start(0) === 110 &&
          requests[1]?.reads === 2,
      )
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await nextTask()

      if (phase === "before-sourceopen") {
        current.sourceOpen.hold = true
      }
      present(current.sources[0]?.sourceBuffers[0]).usable = false
      current.media.buffered.ranges = []
      failedChunk.resolve({ done: false, value: new Uint8Array([2]) })

      if (phase === "before-cancel") {
        echo()
      } else if (phase === "during-cancel") {
        await cancellationStarted.promise
        await nextTask()
        deepEqual(requests.length, 2)
        deepEqual(current.sources.length, 1)
        echo()
        cancellationReleased.resolve()
      } else if (phase === "before-sourceopen") {
        await eventually(
          () =>
            current.sources.length === 2 &&
            current.sourceOpen.pending.length === 1,
        )
        echo()
        await nextTask()
        current.sourceOpen.hold = false
        current.sourceOpen.release()
      }

      await eventually(
        () =>
          requests.length >= 3 &&
          requests[2]?.reads === 2 &&
          current.sources[1]?.sourceBuffers[0]?.buffered.start(0) === 110,
      )
      if (phase === "after-read") {
        present(current.sources[1]?.sourceBuffers[0]).buffered.ranges = []
        current.media.buffered.ranges = []
        await nextTask()
        echo()
      }
      await nextTask()

      const [firstSource, , replacementSource] = requests.map(
        ({ source }) => source,
      )
      deepEqual(
        {
          aborted: requests.map(({ signal }) => signal.aborted),
          cancellations: requests.map(({ cancellations }) => cancellations),
          diagnostics: current.errors.length,
          requests: requests.map(({ time }) => time),
          sources: requests.map(({ source }) =>
            source === firstSource ? 0 : source === replacementSource ? 1 : -1,
          ),
        },
        {
          aborted: [true, true, false],
          cancellations: [1, 1, 0],
          diagnostics: 1,
          requests: ["40", "110", "110"],
          sources: [0, 0, 1],
        },
      )
      deepEqual(current.sources.length, 2)
    } finally {
      cancellationReleased.resolve()
      current.sourceOpen.hold = false
      while (current.sourceOpen.pending.length) {
        current.sourceOpen.release()
      }
      controller.abort()
      await playback
    }
  })
}

test(
  "an owned replacement seek cannot bypass setup backoff",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const laterChunk =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const requests: Array<{ signal: AbortSignal; time: string | null }> = []
    let targetReads = 0
    current.context.fetch = async (url, { signal }) => {
      requests.push({
        signal,
        time: new URL(String(url)).searchParams.get("t"),
      })
      if (requests.length !== 2) {
        return liveResponse(signal)
      }
      return mockResponse({
        getReader: () => ({
          cancel: async () => {},
          read: async () => {
            targetReads += 1
            return targetReads === 1
              ? { done: false, value: new Uint8Array([1]) }
              : laterChunk.promise
          },
        }),
      })
    }

    const originalAddSourceBuffer =
      current.context.MediaSource.prototype.addSourceBuffer
    const setupFailure = new Error("replacement setup failed")
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(
        () =>
          requests.length === 2 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.start(0) === 110 &&
          targetReads === 2,
      )
      current.media.seeking = false
      current.media.dispatchEvent(new Event("seeked"))
      await nextTask()

      current.sourceOpen.hold = true
      present(current.sources[0]?.sourceBuffers[0]).usable = false
      laterChunk.resolve({ done: false, value: new Uint8Array([2]) })
      await eventually(
        () =>
          current.sources.length === 2 &&
          current.sourceOpen.pending.length === 1,
      )
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()

      const replacement = present(current.sources[1])
      current.context.MediaSource.prototype.addSourceBuffer = function (
        type: string,
      ) {
        if (this === replacement) {
          throw setupFailure
        }
        return originalAddSourceBuffer.call(this, type)
      }
      current.sourceOpen.hold = false
      current.sourceOpen.release()
      await eventually(() => clock.length === 1)
      for (let turn = 0; turn < 4; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      deepEqual(current.sources.length, 2)
      deepEqual(clock.callbacks, 0)
      deepEqual(clock.cancellations, 0)
      deepEqual(
        requests.map(({ time }) => time),
        ["40", "110"],
      )
      deepEqual(current.errors.length, 1)
    } finally {
      current.context.MediaSource.prototype.addSourceBuffer =
        originalAddSourceBuffer
      controller.abort()
      while (current.sourceOpen.pending.length) {
        current.sourceOpen.release()
      }
      await playback
      clock.dispose()
    }
  },
)

test(
  "cancellation after sourceopen cannot acquire a SourceBuffer",
  options,
  async () => {
    const current = await fixture()
    current.sourceOpen.hold = true
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    await eventually(() => current.sourceOpen.pending.length === 1)
    current.sourceOpen.release()
    controller.abort()
    await playback

    deepEqual(current.sources.length, 1)
    deepEqual(current.sources[0]?.sourceBuffers.length, 0)
    deepEqual(current.media.loads, 1)
    deepEqual(current.revoked.length, 1)
  },
)

test(
  "an ordinary unbuffered seek keeps one target request and one MediaSource",
  options,
  async () => {
    const current = await fixture()
    const secondRequest = Promise.withResolvers<string>()
    let requests = 0
    let targetSignal: AbortSignal | undefined = undefined
    current.context.fetch = async (url, { signal }) => {
      requests += 1
      if (requests === 2) {
        targetSignal = signal
        secondRequest.resolve(String(url))
      }
      return liveResponse(signal)
    }
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    await eventually(() => requests >= 1)
    const mediaSource = present(current.sources[0])
    await eventually(() => mediaSource.sourceBuffers[0]?.buffered.length === 1)
    const source = current.media.src
    current.media.currentTimes.length = 0
    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))
    current.media.dispatchEvent(new Event("waiting"))
    current.media.dispatchEvent(new Event("canplay"))

    const request = new URL(await secondRequest.promise)
    deepEqual(mediaSource.ends, 0)
    await eventually(
      () => mediaSource.sourceBuffers[0]?.buffered.start(0) === 110,
    )
    current.media.dispatchEvent(new Event("progress"))
    current.media.dispatchEvent(new Event("timeupdate"))
    current.media.dispatchEvent(new Event("seeking"))
    current.media.seeking = false
    current.media.dispatchEvent(new Event("seeked"))
    await new Promise((resolve) => setImmediate(resolve))
    deepEqual(request.searchParams.get("t"), "110")
    deepEqual(requests, 2)
    deepEqual(present<AbortSignal>(targetSignal).aborted, false)
    deepEqual(current.sources.length, 1)
    deepEqual(current.subtitle.sources.length, 1)
    deepEqual(
      new URL(present(current.subtitle.sources[0])).searchParams.get("t"),
      "0",
    )
    deepEqual(current.media.src, source)
    deepEqual(current.media.currentTime, 110)
    deepEqual(current.media.currentTimes.includes(0), false)
    deepEqual(current.media.loads, 0)
    deepEqual(current.revoked.length, 0)

    controller.abort()
    await playback
  },
)

test(
  "a new page lifetime starts at the persisted target",
  options,
  async () => {
    const current = await fixture()
    current.timeInput.value = "110"
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => current.requests.length !== 0)
      deepEqual(
        new URL(present(current.requests[0])).searchParams.get("t"),
        "110",
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a synchronous playback seek storm fetches only its final target",
  options,
  async () => {
    const current = await fixture()
    const requests: string[] = []
    current.context.fetch = async (url, { signal }) => {
      const request = String(url)
      requests.push(request)
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      for (let position = 100; position < 164; position += 1) {
        current.media.currentTime = position
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
      }
      await eventually(() =>
        requests.some((url) => new URL(url).searchParams.get("t") === "163"),
      )

      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "163"],
      )
      deepEqual(current.timeInput.value, "163")
      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 0)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a failed target request retries on the same MediaSource",
  options,
  async () => {
    const current = await fixture()
    const retried = Promise.withResolvers<string>()
    let requests = 0
    current.context.fetch = async (url, { signal }) => {
      requests += 1
      if (requests === 2) {
        throw new Error("target request failed")
      }
      if (requests === 3) {
        retried.resolve(String(url))
      }
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const source = current.media.src
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))

      const request = new URL(await retried.promise)
      deepEqual(request.searchParams.get("t"), "110")
      deepEqual(requests, 3)
      deepEqual(current.sources.length, 1)
      deepEqual(current.media.src, source)
      deepEqual(current.media.currentTime, 110)
      deepEqual(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a contiguous request outage reports once across retries",
  options,
  async () => {
    const current = await fixture()
    const succeeded = Promise.withResolvers<void>()
    const clock = frozenClock(current.context)
    const requests: string[] = []
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length <= 3) {
        throw new Error("source unavailable")
      }
      succeeded.resolve()
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      for (let retry = 0; retry < 3; retry += 1) {
        await eventually(() => clock.length > retry)
        clock.advance(retry)
      }
      await succeeded.promise

      deepEqual(requests.length, 4)
      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40", "40", "40"],
      )
      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "successful buffered progress starts a new request failure storm",
  options,
  async () => {
    const current = await fixture()
    const firstFailure = new Error("first request outage")
    const secondFailure = new Error("later request outage")
    const failAfterProgress =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const clock = frozenClock(current.context)
    const requests: string[] = []
    let recoveredReads = 0
    current.context.fetch = async (url) => {
      requests.push(String(url))
      if (requests.length === 1) {
        throw firstFailure
      }
      return mockResponse({
        getReader: () => ({
          cancel: async () => {},
          read: async () => {
            recoveredReads += 1
            return recoveredReads === 1
              ? {
                  done: false as const,
                  value: new Uint8Array([1]),
                }
              : failAfterProgress.promise
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      clock.advance(0)
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )

      failAfterProgress.reject(secondFailure)
      await eventually(() => clock.length >= 2)

      deepEqual(
        current.errors.map(([error]) => error),
        [firstFailure, secondFailure],
      )
      deepEqual(requests.length, 2)
      deepEqual(current.sources.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a contiguous MSE setup outage reports once and keeps retrying",
  options,
  async () => {
    const current = await fixture()
    const failures = [
      new Error("first MSE setup failure"),
      new Error("second MSE setup failure"),
      new Error("third MSE setup failure"),
    ]
    const clock = frozenClock(current.context)
    let attempts = 0
    const originalAddSourceBuffer =
      current.context.MediaSource.prototype.addSourceBuffer
    current.context.MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ) {
      const failure = failures[attempts]
      attempts += 1
      if (failure) {
        throw failure
      }
      return originalAddSourceBuffer.call(this, type)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      for (let retry = 0; retry < failures.length; retry += 1) {
        await eventually(() => clock.length > retry)
        clock.advance(retry)
      }
      await eventually(
        () => current.sources[3]?.sourceBuffers[0]?.buffered.length === 1,
      )

      deepEqual(attempts, 4)
      deepEqual(current.sources.length, 4)
      deepEqual(
        current.errors.map(([error]) => error),
        [failures[0]],
      )
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test("an undefined MSE setup failure remains retryable", options, async () => {
  const current = await fixture()
  const clock = frozenClock(current.context)
  let attempts = 0
  const originalAddSourceBuffer =
    current.context.MediaSource.prototype.addSourceBuffer
  current.context.MediaSource.prototype.addSourceBuffer = function (
    type: string,
  ) {
    attempts += 1
    if (attempts === 1) {
      throw undefined
    }
    return originalAddSourceBuffer.call(this, type)
  }

  const controller = new AbortController()
  const playback = current.context.player_test.playback_page(controller.signal)
  try {
    await eventually(() => clock.length === 1)
    clock.advance(0)
    await eventually(
      () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
    )

    deepEqual(attempts, 2)
    deepEqual(current.sources.length, 2)
    deepEqual(current.errors, [[undefined]])
  } finally {
    controller.abort()
    await playback
    clock.dispose()
  }
})

test(
  "a failed object URL acquisition installs no source observers",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const failure = new Error("object URL acquisition failed")
    const createObjectURL = current.context.URL.createObjectURL
    current.context.URL.createObjectURL = () => {
      throw failure
    }
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    try {
      await eventually(() => clock.length === 1)
      const source = present(current.sources[0])
      const calls = source.listenerCalls
      source.dispatchEvent(new Event("sourceopen"))
      source.dispatchEvent(new Event("sourceclose"))

      deepEqual(source.listenerCalls, calls)
      deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
    } finally {
      current.context.URL.createObjectURL = createObjectURL
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a synchronous source attachment failure releases its MSE acquisition",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const failure = new Error("source attachment failed")
    Object.defineProperty(current.media, "src", {
      get: () => "",
      set: () => {
        throw failure
      },
    })
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    try {
      await eventually(() => clock.length === 1)
      deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
      deepEqual(current.sources.length, 1)
      deepEqual(current.revoked.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a failed initial seek retains ownership of its attached URL",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const failure = new Error("initial seek failed")
    let currentTime = current.media.currentTime
    Object.defineProperty(current.media, "currentTime", {
      get: () => currentTime,
      set: (value: number) => {
        if (value === 40) {
          throw failure
        }
        currentTime = value
      },
    })
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    try {
      await eventually(() => clock.length === 1)
      const attached = current.media.src
      match(attached, /^blob:player-/)
      deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
      deepEqual(current.sources.length, 1)
      deepEqual(current.revoked, [])

      controller.abort()
      await playback
      deepEqual(current.media.src, "")
      deepEqual(current.media.loads, 1)
      deepEqual(current.revoked, [attached])
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a throwing media detach still revokes its URL and closes observation",
  options,
  async () => {
    const current = await fixture()
    const failure = new Error("media detach failed")
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    await eventually(
      () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
    )
    current.media.load = () => {
      current.media.loads += 1
      throw failure
    }

    controller.abort()
    await rejects(playback, (error) => error === failure)

    deepEqual(current.media.loads, 1)
    deepEqual(current.revoked.length, 1)
    const calls = current.media.listenerCalls
    current.media.dispatchEvent(new Event("timeupdate"))
    deepEqual(current.media.listenerCalls, calls)
  },
)

test(
  "an unbuffered seek supersedes frozen MSE setup backoff immediately",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const failure = new Error("MSE setup failed")
    let attempts = 0
    const originalAddSourceBuffer =
      current.context.MediaSource.prototype.addSourceBuffer
    current.context.MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ) {
      attempts += 1
      if (attempts === 1) {
        throw failure
      }
      return originalAddSourceBuffer.call(this, type)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      current.media.topology.length = 0
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()
      await eventually(
        () => current.sources.length === 2 && current.requests.length === 1,
      )

      const replacement = present(current.sources[1])
      const url = current.media.src
      const positioned = current.media.topology.indexOf("time:110")
      deepEqual(
        new URL(present(current.requests[0])).searchParams.get("t"),
        "110",
      )
      notEqual(positioned, -1)
      assert(positioned < current.media.topology.indexOf(`open:${url}`))
      deepEqual(replacement.sourceBuffers.length, 1)
      deepEqual(clock.callbacks, 0)
      deepEqual(clock.cancellations, 1)
      deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

const setupBackoffMediaFailureCases = [
  {
    deadline: false,
    name: "a media failure supersedes MSE setup backoff without a second diagnostic",
  },
  {
    deadline: true,
    name: "a media failure at the setup retry deadline rebuilds MSE once",
  },
] as const

for (const { deadline, name } of setupBackoffMediaFailureCases) {
  test(name, options, async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const setupFailure = new Error("MSE setup failed")
    const mediaFailure = { code: 3, message: "media failed during backoff" }
    let attempts = 0
    const originalAddSourceBuffer =
      current.context.MediaSource.prototype.addSourceBuffer
    current.context.MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ) {
      attempts += 1
      if (attempts === 1) {
        throw setupFailure
      }
      return originalAddSourceBuffer.call(this, type)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      current.media.error = mediaFailure
      current.media.dispatchEvent(new Event("error"))
      if (deadline) {
        clock.advance(0)
      }
      await eventually(
        () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )

      deepEqual(attempts, 2)
      deepEqual(clock.callbacks, deadline ? 1 : 0)
      deepEqual(clock.cancellations, deadline ? 0 : 1)
      deepEqual(
        current.errors.map(([error]) => error),
        [setupFailure],
      )
      deepEqual(
        new URL(present(current.requests[0])).searchParams.get("t"),
        "40",
      )
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  })
}

test(
  "a media failure at the transport retry deadline retires MSE before mutation",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const requestFailure = new Error("source request failed")
    let requests = 0
    current.context.fetch = async (_url, { signal }) => {
      requests += 1
      if (requests === 1) throw requestFailure
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      const retiring = present(current.sources[0]?.sourceBuffers[0])
      const mediaFailure = { code: 3, message: "media failed at retry" }
      current.media.error = mediaFailure
      current.media.dispatchEvent(new Event("error"))
      clock.advance(0)
      await eventually(
        () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )

      deepEqual(retiring.aborts, 0)
      deepEqual(requests, 2)
      deepEqual(current.sources.length, 2)
      deepEqual(current.errors, [[requestFailure]])
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "benign page activity preserves one original retry deadline",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const requests: string[] = []
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length === 1) {
        throw new Error("source request failed")
      }
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      for (let event = 0; event < 64; event += 1) {
        current.media.dispatchEvent(new Event("timeupdate"))
        current.media.dispatchEvent(new Event("progress"))
        await new Promise((resolve) => setImmediate(resolve))
      }

      deepEqual(clock.length, 1)
      deepEqual(clock.callbacks, 0)
      deepEqual(clock.cancellations, 0)
      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40"],
      )

      clock.advance(0)
      await eventually(() => requests.length === 2)

      deepEqual(clock.length, 1)
      deepEqual(clock.callbacks, 1)
      deepEqual(clock.cancellations, 0)
      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40"],
      )
      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "an unbuffered seek supersedes frozen network backoff immediately",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const requests: string[] = []
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length === 1) {
        throw new Error("source request failed")
      }
      return liveResponse(signal)
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await nextTask()
      await eventually(() => requests.length === 2)

      deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "110"],
      )
      deepEqual(clock.length, 1)
      deepEqual(clock.callbacks, 0)
      deepEqual(clock.cancellations, 1)
      deepEqual(current.timeInput.value, "110")
      deepEqual(current.media.currentTime, 110)
      deepEqual(current.sources.length, 1)
      deepEqual(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "live MediaSource replacement is an atomic blob handoff",
  options,
  async () => {
    const current = await fixture()
    const replaced = Promise.withResolvers<string>()
    const requests: string[] = []
    let activeReaders = 0
    let retryDelays = 0
    let firstResponse: ReadableStreamDefaultController<Uint8Array> | undefined =
      undefined
    current.context.setTimeout = (run, delay = 0) => {
      if (delay > 0) {
        retryDelays += 1
      }
      return setTimeout(run, 0)
    }
    current.context.fetch = async (url) => {
      requests.push(String(url))
      if (firstResponse) {
        replaced.resolve(String(url))
      }
      return mockResponse(
        new ReadableStream({
          start: (controller) => {
            activeReaders += 1
            if (!firstResponse) {
              firstResponse = controller
            }
            controller.enqueue(new Uint8Array([1]))
          },
          cancel: () => {
            activeReaders -= 1
          },
        }),
      )
    }
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    let oldUrl = ""
    let newUrl = ""
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      oldUrl = current.media.src
      current.media.topology.length = 0
      const source = present(current.sources[0])
      present(source.sourceBuffers[0]).usable = false
      const response =
        present<ReadableStreamDefaultController<Uint8Array>>(firstResponse)
      response.enqueue(new Uint8Array([2]))

      const request = new URL(await replaced.promise)
      newUrl = current.media.src
      deepEqual(request.searchParams.get("t"), "40")
      deepEqual(current.timeInput.value, "40")
      match(oldUrl, /^blob:player-/)
      match(newUrl, /^blob:player-/)
      notEqual(newUrl, oldUrl)
      deepEqual(current.media.loads, 0)
      deepEqual(current.media.removals, 0)
      deepEqual(activeReaders, 1)
      deepEqual(current.revoked, [oldUrl])
      assert(
        current.media.topology.indexOf(`open:${newUrl}`) <
          current.media.topology.indexOf(`revoke:${oldUrl}`),
      )
      const positioned = current.media.topology.indexOf("time:40")
      notEqual(positioned, -1)
      assert(positioned < current.media.topology.indexOf(`open:${newUrl}`))
      deepEqual(retryDelays, 0)
      deepEqual(
        requests.some((url) => new URL(url).searchParams.get("t") === "0"),
        false,
      )
    } finally {
      controller.abort()
      await playback
    }

    deepEqual(current.media.src, "")
    deepEqual(current.media.removals, 1)
    deepEqual(current.media.loads, 1)
    deepEqual(activeReaders, 0)
    deepEqual(current.sources.length, 2)
    deepEqual(retryDelays, 0)
    deepEqual(current.revoked, [oldUrl, newUrl])
  },
)

test(
  "a failed parser abort rebuilds once at the requested target",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const source = present(current.sources[0])
      present(source.sourceBuffers[0]).abortError = new DOMException(
        "The operation was aborted",
        "AbortError",
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))

      await eventually(
        () => current.sources.length === 2 && current.requests.length === 2,
      )
      deepEqual(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "110",
      )
      deepEqual(current.sources.length, 2)
      deepEqual(current.errors.length, 1)
      deepEqual(
        current.requests.some(
          (url) => new URL(url).searchParams.get("t") === "0",
        ),
        false,
      )
    } finally {
      controller.abort()
      await doesNotReject(playback)
    }
  },
)

test(
  "parser progress without a buffered frontier stays in one failure storm",
  options,
  async () => {
    const current = await fixture()
    const firstFailure = new Error("first request outage")
    const parserFailure = new Error("parser-only retry outage")
    const recoveredFailure = new Error("post-recovery outage")
    const clock = frozenClock(current.context)
    let requests = 0
    const originalAddSourceBuffer =
      current.context.MediaSource.prototype.addSourceBuffer
    current.context.MediaSource.prototype.addSourceBuffer = function (
      type: string,
    ) {
      const buffer = originalAddSourceBuffer.call(this, type)
      const originalAppendBuffer = buffer.appendBuffer
      buffer.appendBuffer = function (bytes: Uint8Array) {
        if (bytes[0] !== 2) {
          originalAppendBuffer.call(this, bytes)
          return
        }
        this.updating = true
        queueMicrotask(() => {
          this.updating = false
          this.dispatchEvent(new Event("updateend"))
        })
      }
      return buffer
    }
    current.context.fetch = async () => {
      requests += 1
      if (requests === 1) {
        throw firstFailure
      }
      let reads = 0
      return mockResponse({
        getReader: () => ({
          cancel: async () => {},
          read: async () => {
            reads += 1
            if (reads === 1) {
              return {
                done: false as const,
                value: new Uint8Array([requests]),
              }
            }
            throw requests === 2 ? parserFailure : recoveredFailure
          },
        }),
      })
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      await eventually(() => clock.length === 1)
      clock.advance(0)
      await eventually(() => clock.length === 2)
      clock.advance(1)
      await eventually(() => clock.length === 3)

      deepEqual(
        current.errors.map(([error]) => error),
        [firstFailure, recoveredFailure],
      )
      deepEqual(requests, 3)
      deepEqual(current.sources.length, 1)
      deepEqual(current.media.buffered.ranges, [[40, 50]])
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
  },
)

test(
  "a throwing media reporter escapes once and drains both siblings",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    const parent = new AbortController()
    const playback = current.context.player_test.playback_page(parent.signal)
    let outcome:
      | { error: unknown; status: "rejected" }
      | { status: "fulfilled" }
      | undefined = undefined
    const observed = playback.then(
      () => {
        outcome = { status: "fulfilled" }
      },
      (error: unknown) => {
        outcome = { error, status: "rejected" }
      },
    )

    try {
      await eventually(
        () =>
          current.subtitle.sources.length !== 0 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => clock.length === 1)
      const subtitleRequests = current.subtitle.sources.length
      const reporterFailure = new Error("media diagnostic failed")
      let reports = 0
      current.context["console"] = {
        error: () => {
          reports += 1
          throw reporterFailure
        },
      }

      current.media.error = { code: 3, message: "decode failed" }
      current.media.dispatchEvent(new Event("error"))
      await eventually(() => outcome !== undefined)

      deepEqual(outcome, {
        error: reporterFailure,
        status: "rejected",
      })
      deepEqual(reports, 1)
      deepEqual(parent.signal.aborted, false)
      deepEqual(clock.cancellations, 1)
      deepEqual(current.subtitle.sources.length, subtitleRequests)
      deepEqual(current.media.src, "")
      deepEqual(current.media.loads, 1)
      deepEqual(current.revoked.length, 1)
      deepEqual(buffer.usable, false)

      const subtitleCalls = current.subtitle.listenerCalls
      current.subtitle.dispatchEvent(new Event("error"))
      current.subtitle.dispatchEvent(new Event("load"))
      deepEqual(current.subtitle.listenerCalls, subtitleCalls)
    } finally {
      parent.abort()
      await observed
      clock.dispose()
    }
  },
)

test(
  "a throwing transport reporter escapes once and drains both siblings",
  options,
  async () => {
    const current = await fixture()
    const requestFailure = new Error("source request failed")
    current.context.fetch = async () => {
      throw requestFailure
    }
    const reporterFailure = new Error("transport diagnostic failed")
    let reports = 0
    current.context["console"] = {
      error: () => {
        reports += 1
        throw reporterFailure
      },
    }
    const parent = new AbortController()
    const playback = current.context.player_test.playback_page(parent.signal)
    let outcome:
      | { error: unknown; status: "rejected" }
      | { status: "fulfilled" }
      | undefined = undefined
    const observed = playback.then(
      () => {
        outcome = { status: "fulfilled" }
      },
      (error: unknown) => {
        outcome = { error, status: "rejected" }
      },
    )

    try {
      await eventually(
        () => outcome !== undefined || current.sources.length > 1,
      )
      deepEqual(outcome, {
        error: reporterFailure,
        status: "rejected",
      })
      deepEqual(reports, 1)
      deepEqual(parent.signal.aborted, false)
      deepEqual(current.sources.length, 1)
      deepEqual(current.media.src, "")
      deepEqual(current.media.loads, 1)
      deepEqual(current.revoked.length, 1)
    } finally {
      parent.abort()
      await observed
    }
  },
)

const shuffled = cases
  .map((testCase) => ({ order: crypto.randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

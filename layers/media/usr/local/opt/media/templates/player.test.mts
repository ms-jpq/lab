import { readFile } from "node:fs/promises"
import { strict as assert } from "node:assert"
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
type Mse = AsyncGenerator<void, void, MseOperation | undefined>
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
type FailureStorm = { fail: (error: unknown) => void; recover: () => void }
type PageChange = {
  error: unknown | null
  position: number
  restart: boolean
}
type PlayerTest = {
  mse: (signal: AbortSignal, source: MseSource, buffer: MseBuffer) => Mse
  page_changes: AsyncGeneratorFactory<PageChange>
  play_subtitle: (signal: AbortSignal) => Promise<void>
  playback_page: (signal: AbortSignal) => Promise<void>
  session: (
    signal: AbortSignal,
    buffer: {
      next: (operation: MseOperation) => Promise<IteratorResult<void>>
    },
    position: number,
    failures: FailureStorm,
  ) => AsyncGenerator<void, unknown, undefined>
  source_stream: (
    signal: AbortSignal,
    position: number,
  ) => AsyncGenerator<Uint8Array, unknown, undefined>
}
type AsyncGeneratorFactory<TYield, TNext = undefined> = (
  signal: AbortSignal,
  position: number,
) => AsyncGenerator<TYield, void, TNext>
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
}
type TestBody = (context: TestContext) => void | Promise<void>
type TestCase = { name: string; run: TestBody }

const cases: TestCase[] = []
const test = (name: string, _options: typeof options, run: TestBody): void => {
  cases.push({ name, run })
}
const present = <T,>(value: T | undefined): T => {
  assert.ok(value !== undefined)
  return value
}
const nextValue = async <T,>(
  iterator: AsyncIterator<T, unknown, undefined>,
): Promise<T> => {
  const result = await iterator.next()
  assert.equal(result.done, false)
  return result.value
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
  readonly HAVE_FUTURE_DATA: number
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
  paused: boolean
  pauses: number
  playResult: Promise<void>
  plays: number
  readyState: number
  onLoad: (() => void) | undefined
  onSourceChange: ((previous: string, current: string) => void) | undefined
  topology: string[]

  constructor() {
    super()
    this.HAVE_FUTURE_DATA = 3
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
    this.paused = true
    this.pauses = 0
    this.playResult = Promise.resolve()
    this.plays = 0
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
    this.paused = true
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

  pause(): void {
    this.paused = true
    this.pauses += 1
    this.topology.push("pause")
  }

  play(): Promise<void> {
    this.paused = false
    this.plays += 1
    this.topology.push("play")
    return this.playResult
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
  class MediaSource extends EventTarget {
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
  class PlayerURL extends URL {
    static override createObjectURL(
      source: Blob | globalThis.MediaSource | MediaSource,
    ): string {
      assert.ok(source instanceof MediaSource)
      const url = `blob:player-${crypto.randomUUID()}`
      queueMicrotask(() => {
        source.readyState = "open"
        media.topology.push(`open:${url}`)
        source.dispatchEvent(new Event("sourceopen"))
      })
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
    `${source}\nglobalThis.player_test = { mse, page_changes, play_subtitle, playback_page, session, source_stream }`,
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

const readerTeardownCases = [
  {
    abortParent: false,
    cancelRejects: false,
    name: "source stream reads and releases a reader-only response body",
  },
  {
    abortParent: true,
    cancelRejects: true,
    name: "an aborted reader cannot reject stream teardown",
  },
] as const

for (const { abortParent, cancelRejects, name } of readerTeardownCases) {
  test(name, options, async () => {
    const current = await fixture()
    let cancellations = 0
    let reads = 0
    current.context.fetch = async (_url, { signal }) =>
      mockResponse({
        getReader: () => ({
          cancel: async () => {
            cancellations += 1
            assert.equal(signal.aborted, true)
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

    const controller = new AbortController()
    const stream = current.context.player_test.source_stream(
      controller.signal,
      40,
    )
    const chunk = await stream.next()
    assert.equal(chunk.done, false)
    assert.deepEqual([...chunk.value], [1])
    if (abortParent) {
      controller.abort()
    }
    await assert.doesNotReject(stream.return(undefined))

    assert.equal(reads, 1)
    assert.equal(cancellations, 1)
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

    const controller = new AbortController()
    const stream = current.context.player_test.source_stream(
      controller.signal,
      40,
    )
    const chunk = await stream.next()
    assert.equal(chunk.done, false)
    assert.deepEqual([...chunk.value], [1])
    const end = await stream.next()

    assert.equal(end.done, true)
    assert.deepEqual(
      { aborts, cancellations, reads },
      { aborts: 0, cancellations: 0, reads: 2 },
    )
  },
)

const ready = async (
  current: Awaited<ReturnType<typeof fixture>>,
  position = 40,
) => {
  const controller = new AbortController()
  const states = current.context.player_test.page_changes(
    controller.signal,
    position,
  )
  await states.next()
  current.ranges.push([0, 100])
  current.media.readyState = 1
  const aligned = states.next()
  current.media.dispatchEvent(new Event("canplay"))
  await aligned
  const acknowledged = states.next()
  current.media.dispatchEvent(new Event("timeupdate"))
  await acknowledged
  return { controller, states }
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
    const states = current.context.player_test.page_changes(
      controller.signal,
      40,
    )
    await states.next()

    const transient = states.next()
    current.media.dispatchEvent(new Event("timeupdate"))
    await transient
    assert.equal(current.timeInput.value, "40")

    const aligned = states.next()
    current.media.readyState = 1
    current.media.dispatchEvent(new Event("loadedmetadata"))
    await aligned
    assert.equal(current.media.currentTime, 40)
    controller.abort()
  },
)

test(
  "returning page states detaches observers from a live parent",
  options,
  async () => {
    const current = await fixture()
    const parent = new AbortController()
    const states = current.context.player_test.page_changes(parent.signal, 40)
    await states.next()
    const calls = current.media.listenerCalls

    await states.return(undefined)
    assert.equal(parent.signal.aborted, false)
    current.media.dispatchEvent(new Event("timeupdate"))

    assert.equal(current.media.listenerCalls, calls)
    assert.equal((await states.next()).done, true)
  },
)

test(
  "a suspended observation batch awaits its captured task boundary",
  options,
  async () => {
    const current = await fixture()
    const scheduled: Array<() => void> = []
    current.context.setTimeout = (run) => {
      const timeout = setTimeout(() => {}, 10_000)
      scheduled.push(() => {
        clearTimeout(timeout)
        run()
      })
      return timeout
    }
    const controller = new AbortController()
    const states = current.context.player_test.page_changes(
      controller.signal,
      40,
    )
    await states.next()

    current.media.error = { code: 3, message: "decode failed" }
    current.media.dispatchEvent(new Event("error"))
    let settled = false
    const pending = states.next().then((result) => {
      settled = true
      return result
    })
    await Promise.resolve()
    assert.equal(settled, false)

    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))
    assert.equal(scheduled.length, 1)
    present(scheduled[0])()

    const change = await nextValue({ next: () => pending })
    assert.equal(change.error, current.media.error)
    assert.equal(change.position, 110)
    assert.equal(change.restart, true)
    controller.abort()
    await states.return(undefined)
  },
)

test("subtitle events stay outside media state batches", options, async () => {
  const current = await fixture()
  const controller = new AbortController()
  const states = current.context.player_test.page_changes(controller.signal, 40)
  await states.next()
  let observed = false
  const pending = states.next().then((result) => {
    observed = true
    return result
  })

  current.subtitle.dispatchEvent(new Event("error"))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed, false)

  controller.abort()
  assert.equal((await pending).done, true)
  await states.return(undefined)
})

test(
  "ready playback crossing below future data pauses one owned attempt",
  options,
  async () => {
    const current = await fixture()
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()

      assert.equal(current.media.pauses, 1)
      assert.equal(current.media.paused, true)
      assert.deepEqual(
        current.media.topology.filter(
          (operation) => operation === "pause" || operation === "play",
        ),
        ["pause"],
      )
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "initial low readiness does not abort a pending play operation",
  options,
  async () => {
    const current = await fixture()
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.paused = false
      current.media.dispatchEvent(new Event("play"))
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()

      assert.equal(current.media.pauses, 0)
      assert.equal(current.media.paused, false)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "prior readiness does not make a pending play established",
  options,
  async () => {
    const current = await fixture()
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()

      current.media.paused = false
      current.media.dispatchEvent(new Event("play"))
      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()

      assert.equal(current.media.pauses, 0)
      assert.equal(current.media.paused, false)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a user play-pause override revokes an owned readiness resume",
  options,
  async () => {
    const current = await fixture()
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      assert.equal(current.media.pauses, 1)

      await current.media.play()
      current.media.dispatchEvent(new Event("play"))
      current.media.pause()
      current.media.dispatchEvent(new Event("pause"))
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()

      assert.equal(current.media.plays, 1)
      assert.equal(current.media.pauses, 2)
      assert.equal(current.media.paused, true)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "canplay resumes one owned pause and awaits the play promise",
  options,
  async () => {
    const current = await fixture()
    const resumed = Promise.withResolvers<void>()
    current.media.playResult = resumed.promise
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      assert.equal(current.media.pauses, 1)

      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      assert.equal(current.media.plays, 1)
      assert.deepEqual(
        current.media.topology.filter(
          (operation) => operation === "pause" || operation === "play",
        ),
        ["pause", "play"],
      )

      let closed = false
      const closing = playback.then(() => {
        closed = true
      })
      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(closed, false)
      resumed.resolve()
      await closing
      assert.equal(closed, true)
    } finally {
      controller.abort()
      resumed.resolve()
      await playback
    }
  },
)

test(
  "a pending readiness resume does not block a later seek",
  options,
  async () => {
    const current = await fixture()
    const resumed = Promise.withResolvers<void>()
    current.media.playResult = resumed.promise
    const { controller, playback } = await runningPlayback(current)
    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      assert.equal(current.media.plays, 1)

      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(() => current.requests.length === 2)
      assert.equal(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "110",
      )
    } finally {
      resumed.resolve()
      controller.abort()
      await playback
    }
  },
)

test("an ordinary user pause is never auto-resumed", options, async () => {
  const current = await fixture()
  const { controller, playback } = await runningPlayback(current)
  try {
    current.media.readyState = current.media.HAVE_FUTURE_DATA
    current.media.paused = false
    current.media.dispatchEvent(new Event("play"))
    await new Promise((resolve) => setImmediate(resolve))

    current.media.pause()
    current.media.dispatchEvent(new Event("pause"))
    current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
    current.media.dispatchEvent(new Event("waiting"))
    current.media.readyState = current.media.HAVE_FUTURE_DATA
    current.media.dispatchEvent(new Event("canplay"))
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(current.media.pauses, 1)
    assert.equal(current.media.plays, 0)
    assert.equal(current.media.paused, true)
    assert.deepEqual(
      current.media.topology.filter(
        (operation) => operation === "pause" || operation === "play",
      ),
      ["pause"],
    )
  } finally {
    controller.abort()
    await playback
  }
})

test(
  "owner cancellation drains a rejecting pending play promise",
  options,
  async () => {
    const current = await fixture()
    const resumed = Promise.withResolvers<void>()
    current.media.playResult = resumed.promise
    const { controller, playback } = await runningPlayback(current)
    let released = false
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      assert.equal(current.media.pauses, 1)

      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      assert.equal(current.media.plays, 1)

      let settled = false
      const observed = playback.then(() => {
        settled = true
      })
      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(settled, false)

      released = true
      resumed.reject(new DOMException("playback cancelled", "AbortError"))
      await observed
      assert.equal(settled, true)
    } finally {
      controller.abort()
      if (!released) {
        resumed.resolve()
      }
      await playback
    }
  },
)

test(
  "a readiness play owns its rejection before yielding",
  options,
  async () => {
    const current = await fixture()
    const resumed = Promise.withResolvers<void>()
    const then = resumed.promise.then.bind(resumed.promise)
    let rejectionOwned = false
    resumed.promise.then = ((fulfilled, rejected) => {
      rejectionOwned = typeof rejected === "function"
      return then(fulfilled, rejected)
    }) as typeof resumed.promise.then
    current.media.playResult = resumed.promise
    const { controller, states } = await ready(current)

    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      const established = states.next()
      current.media.dispatchEvent(new Event("playing"))
      await established

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      const starved = states.next()
      current.media.dispatchEvent(new Event("waiting"))
      await starved

      current.media.readyState = current.media.HAVE_FUTURE_DATA
      const resumedState = states.next()
      current.media.dispatchEvent(new Event("canplay"))
      await resumedState

      assert.equal(rejectionOwned, true)
    } finally {
      controller.abort()
      resumed.reject(
        new DOMException(
          "The fetching process for the media resource was aborted by the user agent at the user's request.",
          "AbortError",
        ),
      )
      await states.return(undefined)
    }
  },
)

test(
  "an owned readiness pause survives an MSE failure rebuild",
  options,
  async () => {
    const current = await fixture()
    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      assert.equal(current.media.pauses, 1)

      const failure = { code: 3, message: "decode failed while waiting" }
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      await eventually(
        () => current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )
      assert.equal(current.media.plays, 0)

      current.media.error = null
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()

      assert.equal(current.media.plays, 1)
      assert.equal(current.media.paused, false)
      assert.deepEqual(
        current.media.topology.filter(
          (operation) => operation === "pause" || operation === "play",
        ),
        ["pause", "play"],
      )
      assert.deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
      assert.equal(current.sources.length, 2)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "a live MSE replacement keeps an aborted readiness attempt local",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    const resumed = Promise.withResolvers<void>()
    const playAbort = new DOMException(
      "The fetching process for the media resource was aborted by the user agent at the user's request.",
      "AbortError",
    )
    let replacements = 0
    let thirdSource = false

    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      current.media.playResult = resumed.promise
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      assert.equal(current.media.plays, 1)

      current.media.onSourceChange = (previous, next) => {
        if (!previous.startsWith("blob:") || !next.startsWith("blob:")) {
          return
        }
        replacements += 1
        if (replacements === 1) {
          resumed.reject(playAbort)
        } else {
          thirdSource = true
          controller.abort()
        }
      }
      const mediaFailure = { code: 3, message: "decode failed" }
      current.media.error = mediaFailure
      current.media.dispatchEvent(new Event("error"))

      await eventually(
        () =>
          thirdSource ||
          current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )
      assert.equal(thirdSource, false)
      assert.equal(controller.signal.aborted, false)
      assert.equal(current.sources.length, 2)

      current.media.error = null
      current.media.playResult = Promise.resolve()
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await eventually(() => current.media.plays === 2)

      assert.deepEqual(
        current.errors.map(([error]) => error),
        [mediaFailure],
      )
      assert.equal(
        current.requests.some(
          (url) => new URL(url).searchParams.get("t") === "0",
        ),
        false,
      )
    } finally {
      current.media.onSourceChange = undefined
      controller.abort()
      await playback
    }
  },
)

test(
  "a current-source play failure advances the page before rebuilding",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    const resumed = Promise.withResolvers<void>()
    const playFailure = new DOMException("play failed", "NotSupportedError")
    let replacements = 0

    try {
      await eventually(
        () => current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()
      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()

      current.media.playResult = resumed.promise
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      current.media.onSourceChange = (previous, next) => {
        if (previous.startsWith("blob:") && next.startsWith("blob:")) {
          replacements += 1
          if (replacements > 1) {
            controller.abort()
          }
        }
      }
      resumed.reject(playFailure)

      await eventually(
        () =>
          controller.signal.aborted ||
          current.sources[1]?.sourceBuffers[0]?.buffered.length === 1,
      )
      assert.equal(controller.signal.aborted, false)
      assert.equal(current.sources.length, 2)
      assert.deepEqual(
        current.errors.map(([error]) => error),
        [playFailure],
      )

      current.media.currentTime = 100
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      await eventually(() =>
        current.requests.some(
          (url) => new URL(url).searchParams.get("t") === "100",
        ),
      )
      assert.equal(current.sources.length, 2)
    } finally {
      current.media.onSourceChange = undefined
      controller.abort()
      await playback
    }
  },
)

test(
  "owner teardown settles its pending readiness play promise",
  options,
  async () => {
    const current = await fixture()
    const resumed = Promise.withResolvers<void>()
    current.media.playResult = resumed.promise
    let ownerSettled = false
    const settlePlay = () => {
      if (current.media.plays === 0 || ownerSettled) {
        return
      }
      ownerSettled = true
      resumed.reject(new DOMException("playback cancelled", "AbortError"))
    }
    const pause = current.media.pause.bind(current.media)
    current.media.pause = () => {
      pause()
      settlePlay()
    }
    const load = current.media.onLoad
    current.media.onLoad = () => {
      load?.()
      settlePlay()
    }

    const { controller, playback } = await runningPlayback(current)
    try {
      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.paused = false
      current.media.dispatchEvent(new Event("playing"))
      await nextTask()

      current.media.readyState = current.media.HAVE_FUTURE_DATA - 1
      current.media.dispatchEvent(new Event("waiting"))
      await nextTask()
      assert.equal(current.media.pauses, 1)

      current.media.readyState = current.media.HAVE_FUTURE_DATA
      current.media.dispatchEvent(new Event("canplay"))
      await nextTask()
      assert.equal(current.media.plays, 1)

      let completed = false
      const observed = playback.then(() => {
        completed = true
      })
      controller.abort()
      await nextTask()

      assert.equal(ownerSettled, true)
      await observed
      assert.equal(completed, true)
    } finally {
      controller.abort()
      if (!ownerSettled) {
        resumed.resolve()
      }
      await playback
    }
  },
)

test(
  "a subtitle error storm retries once without touching media",
  options,
  async () => {
    const current = await fixture()
    const clock = frozenClock(current.context)
    current.context.window.dispatchEvent(new Event("pageshow"))
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

      assert.equal(current.errors.length, 1)
      assert.equal(clock.length, 1)
      assert.deepEqual(mediaBoundary(), beforeError)
      clock.advance(0)
      await eventually(
        () => current.subtitle.sources.length === subtitleRequests + 1,
      )

      assert.equal(current.subtitle.sources.length, subtitleRequests + 1)
      const initial = new URL(
        present(current.subtitle.sources[subtitleRequests - 1]),
      )
      const retried = new URL(
        present(current.subtitle.sources[subtitleRequests]),
      )
      assert.equal(retried.searchParams.get("t"), "0")
      assert.notEqual(
        retried.searchParams.get("request"),
        initial.searchParams.get("request"),
      )
      current.subtitle.dispatchEvent(new Event("load"))
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(clock.length, 1)
      assert.equal(current.errors.length, 1)
      assert.deepEqual(mediaBoundary(), beforeError)
    } finally {
      current.context.window.dispatchEvent(new Event("pagehide"))
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
      current.context.window.dispatchEvent(new Event("pageshow"))
      await eventually(
        () =>
          current.subtitle.sources.length !== 0 &&
          current.sources[0]?.sourceBuffers[0]?.buffered.length === 1,
      )
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => clock.length === 1)
      assert.equal(clock.length, 1)
      const subtitleRequests = current.subtitle.sources.length

      current.context.window.dispatchEvent(new Event("pagehide"))
      hidden = true
      await eventually(() => clock.cancellations === 1)
      assert.equal(clock.cancellations, 1)
      clock.advance(0)
      await new Promise((resolve) => setImmediate(resolve))
      assert.equal(current.subtitle.sources.length, subtitleRequests)
      const listenerCalls = current.subtitle.listenerCalls
      current.subtitle.dispatchEvent(new Event("error"))
      current.subtitle.dispatchEvent(new Event("load"))
      assert.equal(current.subtitle.listenerCalls, listenerCalls)
    } finally {
      if (!hidden) {
        current.context.window.dispatchEvent(new Event("pagehide"))
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
    assert.equal(parent.signal.aborted, false)
    const ownedCalls = owned.subtitle.listenerCalls
    owned.subtitle.dispatchEvent(new Event("error"))
    owned.subtitle.dispatchEvent(new Event("load"))
    assert.equal(owned.subtitle.listenerCalls, ownedCalls)
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
      current.context.console = {
        error: () => {
          throw diagnostic
        },
      }
      current.subtitle.dispatchEvent(new Event("error"))
      await eventually(() => outcome !== undefined)

      assert.deepEqual(outcome, { error: diagnostic, status: "rejected" })
      assert.equal(parent.signal.aborted, false)
      assert.equal(present<AbortSignal>(requestSignal).aborted, true)
      assert.equal(current.media.src, "")
      assert.equal(current.media.loads, 1)
      assert.equal(current.revoked.length, 1)
      assert.equal(buffer.usable, false)
      assert.equal(clock.length, 0)

      const mediaCalls = current.media.listenerCalls
      const subtitleCalls = current.subtitle.listenerCalls
      current.media.dispatchEvent(new Event("timeupdate"))
      current.subtitle.dispatchEvent(new Event("error"))
      current.subtitle.dispatchEvent(new Event("load"))
      assert.equal(current.media.listenerCalls, mediaCalls)
      assert.equal(current.subtitle.listenerCalls, subtitleCalls)
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
    const states = current.context.player_test.page_changes(
      controller.signal,
      0,
    )
    await states.next()

    current.media.currentTime = 37
    current.media.seeking = true
    const sought = states.next()
    current.media.dispatchEvent(new Event("seeking"))
    const value = await nextValue({ next: () => sought })
    assert.equal(value.restart, true)
    assert.equal(current.timeInput.value, "37")

    current.ranges.push([0, 10])
    const stale = states.next()
    current.media.dispatchEvent(new Event("canplay"))
    await stale
    assert.equal(current.media.currentTime, 37)
    controller.abort()
  },
)

test(
  "an internal seek acknowledgement cannot become a user seek",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const states = current.context.player_test.page_changes(
      controller.signal,
      40,
    )
    await states.next()

    current.media.readyState = 1
    current.media.dispatchEvent(new Event("loadedmetadata"))
    await states.next()
    assert.equal(current.media.currentTime, 40)

    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))
    current.media.seeking = false
    current.media.dispatchEvent(new Event("seeked"))
    current.media.dispatchEvent(new Event("timeupdate"))
    const change = await nextValue(states)

    assert.equal(change.position, 40)
    assert.equal(change.restart, false)
    assert.equal(current.timeInput.value, "40")
    controller.abort()
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
      const { controller, states } = await ready(current)
      current.media.currentTime = 110
      for (const event of events) {
        if (event === "seeking") {
          current.media.seeking = true
        } else if (event === "seeked") {
          current.media.seeking = false
        }
        current.media.dispatchEvent(new Event(event))
      }

      const change = await nextValue(states)
      assert.equal(change.restart, true)
      assert.equal(change.position, 110)
      assert.equal(current.timeInput.value, "110")
      controller.abort()
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
      const { controller, states } = await ready(current)
      current.ranges.splice(0, current.ranges.length, [range[0], range[1]])
      current.media.currentTime = 70
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      const change = await nextValue(states)

      assert.equal(change.position, target)
      assert.equal(change.restart, false)
      assert.equal(current.timeInput.value, String(Math.floor(target)))
      controller.abort()
    },
  )
}

test("page progress persists only playable positions", options, async () => {
  const current = await fixture()
  const { controller, states } = await ready(current)

  current.media.currentTime = 110
  current.media.dispatchEvent(new Event("timeupdate"))
  await states.next()
  assert.equal(current.timeInput.value, "40")

  current.ranges.push([110, 120])
  current.media.currentTime = 111
  current.media.dispatchEvent(new Event("timeupdate"))
  await states.next()
  assert.equal(current.timeInput.value, "111")
  controller.abort()
})

test("ended resets the resume position", options, async () => {
  const current = await fixture()
  const { controller, states } = await ready(current)
  current.media.currentTime = 200
  current.media.ended = true
  const observed = states.next()
  current.media.dispatchEvent(new Event("ended"))
  await observed
  assert.equal(current.timeInput.value, "0")
  controller.abort()
})

test("exact-end startup requests a playable position", options, async () => {
  const current = await fixture(200)
  const controller = new AbortController()
  const playback = current.context.player_test.playback_page(controller.signal)
  try {
    await eventually(() => current.requests.length === 1)
    assert.equal(
      new URL(present(current.requests[0])).searchParams.get("t"),
      "199",
    )
    assert.equal(current.media.currentTime, 199)
  } finally {
    controller.abort()
    await playback
  }
})

test(
  "an expected native media abort does not become media failure",
  options,
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.media.error = { code: current.context.MediaError.MEDIA_ERR_ABORTED }
    const observed = states.next()
    current.media.dispatchEvent(new Event("error"))
    const value = await nextValue({ next: () => observed })
    assert.equal(value.error, null)
    controller.abort()
  },
)

test("a synchronous event batch emits one media failure", options, async () => {
  const current = await fixture()
  const { controller, states } = await ready(current)
  const failure = { code: 3, message: "decode failed" }
  current.media.error = failure
  current.media.dispatchEvent(new Event("error"))
  current.media.dispatchEvent(new Event("timeupdate"))
  current.media.dispatchEvent(new Event("progress"))
  const change = await nextValue(states)

  assert.equal(change.error, failure)
  controller.abort()
})

test(
  "page state retains a seek following an error in one synchronous batch",
  options,
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    const pending = states.next()
    const failure = { code: 3, message: "decode failed" }

    current.media.error = failure
    current.media.dispatchEvent(new Event("error"))
    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))

    const change = await nextValue({ next: () => pending })
    assert.equal(change.error, failure)
    assert.equal(change.position, 110)
    assert.equal(change.restart, true)
    controller.abort()
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
      assert.equal(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "40",
      )
      assert.equal(current.sources.length, 2)
      assert.equal(current.errors.length, 1)
      assert.equal(current.errors[0]?.[0], failure)
      assert.equal(current.media.loads, 0)
      assert.equal(
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
          () => current.sources.length === 2 && current.requests.length === 2,
        )
        assert.deepEqual(
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
    const controller = new AbortController()
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
    const playback = current.context.player_test.session(
      controller.signal,
      buffer,
      40,
      { fail: () => {}, recover: () => {} },
    )
    try {
      const paused = playback.next()
      await firstAppend.promise
      await paused
      assert.equal(requests, 1)
      assert.equal(appends, 1)

      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const settled = produced
      for (let turn = 0; turn < 8; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      assert.equal(produced, settled)
      assert.ok(completed || aborts > 0 || cancellations > 0)
    } finally {
      producing = false
      controller.abort()
      await playback.return(undefined)
    }
  },
)

test(
  "low water resumes the same session from its buffered frontier",
  options,
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    const firstAppend = Promise.withResolvers<void>()
    const secondRequest = Promise.withResolvers<string>()
    const requests: string[] = []
    let firstAborts = 0
    let firstCancellations = 0
    current.context.fetch = async (url, { signal }) => {
      const request = String(url)
      const index = requests.push(request) - 1
      if (index === 1) {
        secondRequest.resolve(request)
      }
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
              return {
                done: false as const,
                value: new Uint8Array([1]),
              }
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
    const operations: MseOperation[] = []
    let ends = 0
    const buffer = {
      next: async (operation: MseOperation) => {
        operations.push(operation)
        if (operation === "end") {
          ends += 1
        } else if (operation instanceof Uint8Array) {
          current.media.buffered.ranges = [[40, 100]]
          firstAppend.resolve()
        }
        return { done: false as const, value: undefined }
      },
    }
    const playback = current.context.player_test.session(
      controller.signal,
      buffer,
      40,
      { fail: () => {}, recover: () => {} },
    )
    let resumed: Promise<IteratorResult<void, unknown>> | undefined = undefined
    try {
      const paused = playback.next()
      await firstAppend.promise
      assert.equal((await paused).done, false)
      assert.ok(firstAborts > 0 || firstCancellations > 0)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40"],
      )

      current.media.currentTime = 60
      resumed = playback.next()
      const request = new URL(await secondRequest.promise)

      assert.equal(request.searchParams.get("t"), "100")
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "100"],
      )
      assert.deepEqual(
        operations.filter((operation) => typeof operation === "number"),
        [40, 100],
      )
      assert.equal(ends, 0)
    } finally {
      controller.abort()
      await resumed
      await playback.return(undefined)
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

      assert.deepEqual(
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
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
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

    const controller = new AbortController()
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
    const playback = current.context.player_test.session(
      controller.signal,
      buffer,
      40,
      { fail: () => {}, recover: () => {} },
    )
    let ending: Promise<IteratorResult<void, unknown>> | undefined = undefined
    try {
      assert.equal((await playback.next()).done, false)
      assert.equal(firstReads, 1)
      assert.ok(firstAborts > 0 || firstCancellations > 0)

      current.media.currentTime = 60
      ending = playback.next()
      await eventually(() => ends === 1)

      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "100"],
      )
      assert.deepEqual(
        operations.filter((operation) => typeof operation === "number"),
        [40, 100],
      )
      assert.equal(firstReads, 1)
      assert.equal(ends, 1)
    } finally {
      controller.abort()
      await ending
      await playback.return(undefined)
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
    assert.deepEqual(opened.removes, [[0, 70]])

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

    assert.equal(opened.updating, false)
    assert.equal(opened.appendState, "parsing")
    assert.equal((await buffer.next(30)).done, false)
    assert.equal(opened.aborts, 1)
    assert.equal(opened.appendState, "waiting")
    assert.equal(opened.timestampOffset, 30)
    assert.equal(current.sources.length, 1)
    assert.equal(current.media.loads, 0)

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
    assert.equal((await buffer.next("end")).done, false)

    const source = current.media.src
    current.media.currentTime = 30
    assert.equal((await buffer.next(30)).done, false)
    assert.equal(opened.aborts, 1)
    assert.deepEqual(opened.removes, [[20, 20.001]])
    assert.equal(current.media.src, source)
    assert.equal(current.media.currentTime, 30)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.length, 0)

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

    assert.equal(closed, false)

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

      await assert.rejects(appending, (error) => error === failure)
      assert.equal((await later).done, true)
      assert.equal(opened.timestampOffset, 40)
      assert.equal(opened.aborts, 0)
    } finally {
      controller.abort()
      await buffer.return(undefined)
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

    assert.equal(closed, false)
    assert.equal(opened.timestampOffset, 10)
    assert.equal(opened.aborts, 0)

    present(opened.releaseUpdate)()
    assert.equal((await appending).done, false)
    await offsetting
    await closing

    assert.equal(opened.timestampOffset, 10)
    assert.equal(opened.aborts, 0)
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

    const request = new URL(await secondRequest.promise)
    assert.equal(mediaSource.ends, 0)
    await eventually(
      () => mediaSource.sourceBuffers[0]?.buffered.start(0) === 110,
    )
    current.media.dispatchEvent(new Event("progress"))
    current.media.dispatchEvent(new Event("timeupdate"))
    current.media.dispatchEvent(new Event("seeking"))
    current.media.seeking = false
    current.media.dispatchEvent(new Event("seeked"))
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(request.searchParams.get("t"), "110")
    assert.equal(requests, 2)
    assert.equal(present<AbortSignal>(targetSignal).aborted, false)
    assert.equal(current.sources.length, 1)
    assert.equal(current.subtitle.sources.length, 1)
    assert.equal(
      new URL(present(current.subtitle.sources[0])).searchParams.get("t"),
      "0",
    )
    assert.equal(current.media.src, source)
    assert.equal(current.media.currentTime, 110)
    assert.equal(current.media.currentTimes.includes(0), false)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.length, 0)

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
      assert.equal(
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

      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "163"],
      )
      assert.equal(current.timeInput.value, "163")
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 0)
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
      assert.equal(request.searchParams.get("t"), "110")
      assert.equal(requests, 3)
      assert.equal(current.sources.length, 1)
      assert.equal(current.media.src, source)
      assert.equal(current.media.currentTime, 110)
      assert.equal(current.errors.length, 1)
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

      assert.equal(requests.length, 4)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40", "40", "40"],
      )
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
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

      assert.deepEqual(
        current.errors.map(([error]) => error),
        [firstFailure, secondFailure],
      )
      assert.equal(requests.length, 2)
      assert.equal(current.sources.length, 1)
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

      assert.equal(attempts, 4)
      assert.equal(current.sources.length, 4)
      assert.deepEqual(
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
      assert.deepEqual(
        current.errors.map(([error]) => error),
        [failure],
      )
      assert.equal(current.sources.length, 1)
      assert.equal(current.revoked.length, 1)
    } finally {
      controller.abort()
      await playback
      clock.dispose()
    }
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
      assert.equal(
        new URL(present(current.requests[0])).searchParams.get("t"),
        "110",
      )
      assert.notEqual(positioned, -1)
      assert.ok(positioned < current.media.topology.indexOf(`open:${url}`))
      assert.equal(replacement.sourceBuffers.length, 1)
      assert.equal(clock.callbacks, 0)
      assert.equal(clock.cancellations, 1)
      assert.deepEqual(
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

      assert.equal(clock.length, 1)
      assert.equal(clock.callbacks, 0)
      assert.equal(clock.cancellations, 0)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40"],
      )

      clock.advance(0)
      await eventually(() => requests.length === 2)

      assert.equal(clock.length, 1)
      assert.equal(clock.callbacks, 1)
      assert.equal(clock.cancellations, 0)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40"],
      )
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
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

      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "110"],
      )
      assert.equal(clock.length, 1)
      assert.equal(clock.callbacks, 0)
      assert.equal(clock.cancellations, 1)
      assert.equal(current.timeInput.value, "110")
      assert.equal(current.media.currentTime, 110)
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
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
    const playFailure = new DOMException(
      "The operation was aborted",
      "AbortError",
    )
    const pendingPlay = Promise.withResolvers<void>()
    let playRejections = 0
    void pendingPlay.promise.catch((error: unknown) => {
      assert.equal(error, playFailure)
      playRejections += 1
    })
    const release = present(current.media.onLoad)
    current.media.onLoad = () => {
      release()
      pendingPlay.reject(playFailure)
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
      assert.equal(request.searchParams.get("t"), "40")
      assert.equal(current.timeInput.value, "40")
      assert.match(oldUrl, /^blob:player-/)
      assert.match(newUrl, /^blob:player-/)
      assert.notEqual(newUrl, oldUrl)
      assert.equal(current.media.loads, 0)
      assert.equal(current.media.removals, 0)
      assert.equal(playRejections, 0)
      assert.equal(activeReaders, 1)
      assert.deepEqual(current.revoked, [oldUrl])
      assert.ok(
        current.media.topology.indexOf(`open:${newUrl}`) <
          current.media.topology.indexOf(`revoke:${oldUrl}`),
      )
      const positioned = current.media.topology.indexOf("time:40")
      assert.notEqual(positioned, -1)
      assert.ok(positioned < current.media.topology.indexOf(`open:${newUrl}`))
      assert.equal(retryDelays, 0)
      assert.equal(
        requests.some((url) => new URL(url).searchParams.get("t") === "0"),
        false,
      )
    } finally {
      controller.abort()
      await playback
    }

    await Promise.resolve()
    assert.equal(current.media.src, "")
    assert.equal(current.media.removals, 1)
    assert.equal(current.media.loads, 1)
    assert.equal(playRejections, 1)
    assert.equal(activeReaders, 0)
    assert.equal(current.sources.length, 2)
    assert.equal(retryDelays, 0)
    assert.deepEqual(current.revoked, [oldUrl, newUrl])
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
      assert.equal(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "110",
      )
      assert.equal(current.sources.length, 2)
      assert.equal(current.errors.length, 1)
      assert.equal(
        current.requests.some(
          (url) => new URL(url).searchParams.get("t") === "0",
        ),
        false,
      )
    } finally {
      controller.abort()
      await assert.doesNotReject(playback)
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

      assert.deepEqual(
        current.errors.map(([error]) => error),
        [firstFailure, recoveredFailure],
      )
      assert.equal(requests, 3)
      assert.equal(current.sources.length, 1)
      assert.deepEqual(current.media.buffered.ranges, [[40, 50]])
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
      current.context.console = {
        error: () => {
          reports += 1
          throw reporterFailure
        },
      }

      current.media.error = { code: 3, message: "decode failed" }
      current.media.dispatchEvent(new Event("error"))
      await eventually(() => outcome !== undefined)

      assert.deepEqual(outcome, {
        error: reporterFailure,
        status: "rejected",
      })
      assert.equal(reports, 1)
      assert.equal(parent.signal.aborted, false)
      assert.equal(clock.cancellations, 1)
      assert.equal(current.subtitle.sources.length, subtitleRequests)
      assert.equal(current.media.src, "")
      assert.equal(current.media.loads, 1)
      assert.equal(current.revoked.length, 1)
      assert.equal(buffer.usable, false)

      const subtitleCalls = current.subtitle.listenerCalls
      current.subtitle.dispatchEvent(new Event("error"))
      current.subtitle.dispatchEvent(new Event("load"))
      assert.equal(current.subtitle.listenerCalls, subtitleCalls)
    } finally {
      parent.abort()
      await observed
      clock.dispose()
    }
  },
)

const shuffled = cases
  .map((testCase) => ({ order: crypto.randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

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
type MediaObservation = {
  ended: boolean
  error: MediaFailure | null
  seeking: boolean
  time: number
}
type MseOperation = "end" | number | Uint8Array
type Mse = AsyncGenerator<void, void, MseOperation | undefined>
type SourceChange = { position: number } | { error: unknown; position: number }
type PageChange = {
  error: MediaFailure | null
  position: number
  restart: boolean
}
type PlayerTest = {
  buffered_position: (position: number) => number | undefined
  media_observation_batches: (
    signal: AbortSignal,
  ) => AsyncGenerator<MediaObservation[], void, void>
  media_sources: AsyncGeneratorFactory<
    { buffer: Mse; position: number; signal: AbortSignal },
    SourceChange
  >
  page_changes: AsyncGeneratorFactory<PageChange>
  playback_page: (signal: AbortSignal) => Promise<void>
  playable_position: (position: number) => number
  session: (
    signal: AbortSignal,
    buffer: {
      next: (operation: MseOperation) => Promise<IteratorResult<void>>
    },
    position: number,
  ) => AsyncGenerator<void, unknown, undefined>
  source_stream: (
    signal: AbortSignal,
    position: number,
  ) => AsyncGenerator<Uint8Array, unknown, undefined>
  subtitle_sources: (signal: AbortSignal) => AsyncGenerator<unknown, void, void>
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
  player_test: PlayerTest
  setTimeout: (run: () => void) => ReturnType<typeof setTimeout>
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

class Media extends EventTarget {
  currentTimes: number[]
  private _currentTime: number
  buffered: MutableTimeRanges
  dataset: { duration: string; mseType: string; src: string }
  ended: boolean
  error: MediaFailure | null
  seeking: boolean
  private _src: string
  loads: number
  listenerCalls: number
  listenerWrappers: WeakMap<EventListenerOrEventListenerObject, EventListener>
  readyState: number
  onLoad: (() => void) | undefined

  constructor() {
    super()
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
    this.listenerCalls = 0
    this.listenerWrappers = new WeakMap()
    this.readyState = 0
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (!callback) {
      super.addEventListener(type, callback, options)
      return
    }
    const wrapped = (event: Event) => {
      this.listenerCalls += 1
      if (typeof callback === "function") {
        callback.call(this, event)
      } else {
        callback.handleEvent(event)
      }
    }
    this.listenerWrappers.set(callback, wrapped)
    super.addEventListener(type, wrapped, options)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(
      type,
      callback ? (this.listenerWrappers.get(callback) ?? callback) : null,
      options,
    )
  }

  get currentTime() {
    return this._currentTime
  }

  set currentTime(value: number) {
    this._currentTime = value
    this.currentTimes.push(value)
  }

  get src() {
    return this._src
  }

  set src(value: string) {
    this._src = value
    this.buffered.ranges = []
    this.readyState = 0
    this.currentTime = 0
  }

  load(): void {
    this.loads += 1
    this.buffered.ranges = []
    this.onLoad?.()
  }

  removeAttribute(name: string): void {
    if (name === "src") {
      this._src = ""
    }
  }
}

class Subtitle extends EventTarget {
  dataset: { src: string }
  listenerCalls: number
  listenerWrappers: WeakMap<EventListenerOrEventListenerObject, EventListener>
  sources: string[]
  private _src: string

  constructor() {
    super()
    this.dataset = { src: "/movie/subtitle" }
    this.listenerCalls = 0
    this.listenerWrappers = new WeakMap()
    this.sources = []
    this._src = ""
  }

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (!callback) {
      super.addEventListener(type, callback, options)
      return
    }
    const wrapped = (event: Event) => {
      this.listenerCalls += 1
      if (typeof callback === "function") {
        callback.call(this, event)
      } else {
        callback.handleEvent(event)
      }
    }
    this.listenerWrappers.set(callback, wrapped)
    super.addEventListener(type, wrapped, options)
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(
      type,
      callback ? (this.listenerWrappers.get(callback) ?? callback) : null,
      options,
    )
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

    removeSourceBuffer(buffer: SourceBuffer): void {
      this.sourceBuffers = this.sourceBuffers.filter((item) => item !== buffer)
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
        source.dispatchEvent(new Event("sourceopen"))
      })
      return url
    }

    static override revokeObjectURL(url: string): void {
      revoked.push(url)
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
      return {
        body: new ReadableStream<Uint8Array>({
          start: (controller: ReadableStreamDefaultController<Uint8Array>) => {
            controller.enqueue(new Uint8Array([1]))
            controller.close()
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
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
    `${source}\nglobalThis.player_test = { buffered_position, media_observation_batches, media_sources, page_changes, playback_page, playable_position, session, source_stream, source_url, stream_position, subtitle_sources }`,
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
  const lifetime = current.context.player_test.media_sources(
    controller.signal,
    10,
  )
  const opened = await lifetime.next()
  assert.equal(opened.done, false)
  return { buffer: opened.value.buffer, controller, lifetime }
}

test(
  "source stream reads and releases a reader-only response body",
  options,
  async () => {
    const current = await fixture()
    let cancelled = 0
    let reads = 0
    current.context.fetch = async () => ({
      body: {
        getReader: () => ({
          cancel: async () => {
            cancelled += 1
          },
          read: async () => {
            reads += 1
            return { done: false, value: new Uint8Array([1]) }
          },
        }),
      },
      ok: true,
      status: 200,
      statusText: "OK",
    })

    const controller = new AbortController()
    const stream = current.context.player_test.source_stream(
      controller.signal,
      40,
    )
    const chunk = await stream.next()
    assert.equal(chunk.done, false)
    assert.deepEqual([...chunk.value], [1])
    await stream.return(undefined)

    assert.equal(reads, 1)
    assert.equal(cancelled, 1)
  },
)

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
      return {
        body: {
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
        },
        ok: true,
        status: 200,
        statusText: "OK",
      }
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

test("an aborted reader cannot reject stream teardown", options, async () => {
  const current = await fixture()
  let requestSignal: AbortSignal | undefined = undefined
  current.context.fetch = async (_url, { signal }) => {
    requestSignal = signal
    return {
      body: {
        getReader: () => ({
          cancel: async () => {
            assert.equal(present(requestSignal).aborted, true)
            throw new DOMException("The operation was aborted", "AbortError")
          },
          read: async () => ({
            done: false,
            value: new Uint8Array([1]),
          }),
        }),
      },
      ok: true,
      status: 200,
      statusText: "OK",
    }
  }

  const controller = new AbortController()
  const stream = current.context.player_test.source_stream(
    controller.signal,
    40,
  )
  await stream.next()
  controller.abort()

  await assert.doesNotReject(stream.return(undefined))
})

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
  "media state batches preserve synchronous event order",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const batches = current.context.player_test.media_observation_batches(
      controller.signal,
    )
    await batches.next()

    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))
    current.media.seeking = false
    current.media.dispatchEvent(new Event("seeked"))

    const states = await nextValue(batches)
    assert.equal(states.length, 2)
    assert.equal(states[0]?.seeking, true)
    assert.equal(states[0]?.time, 110)
    assert.equal(states[1]?.seeking, false)
    assert.equal(states[1]?.time, 110)
    controller.abort()
    await batches.return(undefined)
  },
)

test("subtitle events stay outside media state batches", options, async () => {
  const current = await fixture()
  const controller = new AbortController()
  const batches = current.context.player_test.media_observation_batches(
    controller.signal,
  )
  await batches.next()
  let observed = false
  const pending = batches.next().then((result) => {
    observed = true
    return result
  })

  current.subtitle.dispatchEvent(new Event("error"))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(observed, false)

  controller.abort()
  assert.equal((await pending).done, true)
})

test(
  "a subtitle error storm retries once without touching media",
  options,
  async () => {
    const current = await fixture()
    const advance: Array<() => void> = []
    current.context.setTimeout = (run) => {
      const timeout = setTimeout(run, 10_000)
      advance.push(() => {
        clearTimeout(timeout)
        run()
      })
      return timeout
    }
    current.context.window.dispatchEvent(new Event("pageshow"))
    try {
      while (
        current.subtitle.sources.length === 0 ||
        current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1
      ) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      await new Promise((resolve) => setImmediate(resolve))
      const subtitleRequests = current.subtitle.sources.length
      const mediaRequests = current.requests.length
      const mediaSources = current.sources.length
      const mediaSource = current.media.src
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      const mseState = () => ({
        aborts: buffer.aborts,
        ends: source.ends,
        offset: buffer.timestampOffset,
        ranges: buffer.buffered.ranges.map(([start, end]) => [start, end]),
        removes: buffer.removes.map(([start, end]) => [start, end]),
      })
      const beforeError = mseState()

      for (let event = 0; event < 64; event += 1) {
        current.subtitle.dispatchEvent(new Event("error"))
      }
      for (let turn = 0; turn < 32 && advance.length === 0; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      assert.equal(current.errors.length, 1)
      assert.equal(advance.length, 1)
      assert.equal(current.requests.length, mediaRequests)
      assert.equal(current.sources.length, mediaSources)
      assert.equal(current.media.src, mediaSource)
      assert.deepEqual(mseState(), beforeError)
      present(advance[0])()
      for (
        let turn = 0;
        turn < 32 && current.subtitle.sources.length === subtitleRequests;
        turn += 1
      ) {
        await new Promise((resolve) => setImmediate(resolve))
      }

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
      assert.equal(advance.length, 1)
      assert.equal(current.errors.length, 1)
      assert.equal(current.requests.length, mediaRequests)
      assert.equal(current.sources.length, mediaSources)
      assert.equal(current.media.src, mediaSource)
      assert.deepEqual(mseState(), beforeError)
    } finally {
      current.context.window.dispatchEvent(new Event("pagehide"))
    }
  },
)

test(
  "subtitle owner cancellation clears frozen retry and listeners",
  options,
  async () => {
    const current = await fixture()
    const scheduled: Array<{
      run: () => void
      timeout: ReturnType<typeof setTimeout>
    }> = []
    let timerCancellations = 0
    current.context.clearTimeout = (timeout) => {
      timerCancellations += 1
      clearTimeout(timeout)
    }
    current.context.setTimeout = (run) => {
      const timeout = setTimeout(run, 10_000)
      scheduled.push({ run, timeout })
      return timeout
    }
    let hidden = false
    try {
      current.context.window.dispatchEvent(new Event("pageshow"))
      while (
        current.subtitle.sources.length === 0 ||
        current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1
      ) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      current.subtitle.dispatchEvent(new Event("error"))
      for (let turn = 0; turn < 32 && scheduled.length === 0; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      assert.equal(scheduled.length, 1)
      const subtitleRequests = current.subtitle.sources.length

      current.context.window.dispatchEvent(new Event("pagehide"))
      hidden = true
      for (let turn = 0; turn < 32 && timerCancellations === 0; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      assert.equal(timerCancellations, 1)
      present(scheduled[0]).run()
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
      for (const { timeout } of scheduled) {
        clearTimeout(timeout)
      }
    }

    const owned = await fixture()
    const parent = new AbortController()
    const owner = new AbortController()
    const attempt = owned.context.player_test.subtitle_sources(
      AbortSignal.any([parent.signal, owner.signal]),
    )
    const pending = attempt.next()
    await new Promise((resolve) => setImmediate(resolve))
    owner.abort()
    assert.equal((await pending).done, true)
    await attempt.return(undefined)
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
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }
    let timers = 0
    current.context.setTimeout = (run) => {
      timers += 1
      return setTimeout(run, 10_000)
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
      while (
        current.subtitle.sources.length === 0 ||
        current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1
      ) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      const diagnostic = new Error("subtitle diagnostic failed")
      current.context.console = {
        error: () => {
          throw diagnostic
        },
      }
      current.subtitle.dispatchEvent(new Event("error"))
      for (let turn = 0; turn < 64 && outcome === undefined; turn += 1) {
        await Promise.resolve()
      }

      assert.deepEqual(outcome, { error: diagnostic, status: "rejected" })
      assert.equal(parent.signal.aborted, false)
      assert.equal(present<AbortSignal>(requestSignal).aborted, true)
      assert.equal(current.media.src, "")
      assert.equal(current.media.loads, 1)
      assert.equal(current.revoked.length, 1)
      assert.equal(buffer.usable, false)
      assert.equal(timers, 0)

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

test(
  "ended resets resume position and exact-end startup stays playable",
  options,
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.media.currentTime = 200
    current.media.ended = true
    const observed = states.next()
    current.media.dispatchEvent(new Event("ended"))
    await observed
    assert.equal(current.timeInput.value, "0")
    assert.equal(current.context.player_test.playable_position(200), 199.5)
    controller.abort()
  },
)

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
  "a media failure storm produces one diagnostic and one same-target reset",
  options,
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const failure = { code: 3, message: "decode failed" }
      current.media.error = failure
      current.media.dispatchEvent(new Event("error"))
      current.media.dispatchEvent(new Event("timeupdate"))
      current.media.dispatchEvent(new Event("progress"))

      while (current.sources.length !== 2 || current.requests.length !== 2) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      assert.equal(
        new URL(present(current.requests[1])).searchParams.get("t"),
        "40",
      )
      assert.equal(current.sources.length, 2)
      assert.equal(current.errors.length, 1)
      assert.equal(current.errors[0]?.[0], failure)
      assert.equal(current.media.loads, 1)
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

test(
  "high water stops an eager transport from growing while paused",
  options,
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    const firstAppend = Promise.withResolvers<void>()
    const queued: Uint8Array[] = []
    let pendingRead:
      | ((result: ReadableStreamReadResult<Uint8Array>) => void)
      | undefined = undefined
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
      return {
        body: {
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
        },
        ok: true,
        status: 200,
        statusText: "OK",
      }
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
      return {
        body: {
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
        },
        ok: true,
        status: 200,
        statusText: "OK",
      }
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

test(
  "a partial request failure retries acquisition from the buffered frontier",
  options,
  async () => {
    const current = await fixture()
    const failed =
      Promise.withResolvers<ReadableStreamReadResult<Uint8Array>>()
    const retried = Promise.withResolvers<string>()
    const retry: Array<() => void> = []
    const requests: string[] = []
    let firstReads = 0
    current.context.setTimeout = (run) => {
      const timeout = setTimeout(run, 10_000)
      retry.push(() => {
        clearTimeout(timeout)
        run()
      })
      return timeout
    }
    current.context.fetch = async (url, { signal }) => {
      const request = String(url)
      const index = requests.push(request) - 1
      if (index === 1) {
        retried.resolve(request)
      }
      return {
        body: {
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
        },
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const source = present(current.sources[0])
      const buffer = present(source.sourceBuffers[0])
      buffer.buffered.ranges = [[40, 55]]
      current.media.buffered.ranges = [[40, 55]]
      while (current.media.currentTime !== 40) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      failed.reject(new Error("request failed after partial progress"))
      while (retry.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      present(retry[0])()
      const request = new URL(await retried.promise)

      assert.deepEqual(
        {
          acquisition: request.searchParams.get("t"),
          offset: buffer.timestampOffset,
          target: current.media.currentTime,
          targetInput: current.timeInput.value,
        },
        {
          acquisition: "55",
          offset: 55,
          target: 40,
          targetInput: "40",
        },
      )
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
    }
  },
)

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
      return {
        body: {
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
        },
        ok: true,
        status: 200,
        statusText: "OK",
      }
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
    )
    let ending: Promise<IteratorResult<void, unknown>> | undefined = undefined
    try {
      assert.equal((await playback.next()).done, false)
      assert.equal(firstReads, 1)
      assert.ok(firstAborts > 0 || firstCancellations > 0)

      current.media.currentTime = 60
      ending = playback.next()
      while (ends !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

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
  "availability aligns adjacent seeks and teardown releases the owned source",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    assert.equal(current.context.player_test.buffered_position(10), 10)
    assert.equal(current.context.player_test.buffered_position(9.95), 10)
    controller.abort()
    await lifetime.return(undefined)
    assert.equal(current.media.src, "")
    assert.equal(current.media.loads, 1)
    assert.equal(current.revoked.length, 1)
  },
)

test(
  "an explicit undefined source error immediately rebuilds at the same target",
  options,
  async () => {
    const current = await fixture()
    let retryDelays = 0
    current.context.setTimeout = (run) => {
      retryDelays += 1
      return setTimeout(run, 0)
    }
    const controller = new AbortController()
    const sources = current.context.player_test.media_sources(
      controller.signal,
      40,
    )

    try {
      const opened = await sources.next()
      assert.equal(opened.done, false)
      const rebuilt = await sources.next({ error: undefined, position: 110 })
      assert.equal(rebuilt.done, false)

      assert.deepEqual(
        {
          errors: current.errors.map(([error]) => error),
          position: rebuilt.value.position,
          retryDelays,
          sources: current.sources.length,
        },
        {
          errors: [undefined],
          position: 110,
          retryDelays: 0,
          sources: 2,
        },
      )
    } finally {
      controller.abort()
      await sources.return(undefined)
    }
  },
)

test(
  "append evicts media more than thirty seconds behind",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    current.media.currentTime = 100
    await buffer.next(new Uint8Array([2]))
    const source = present(current.sources[0])
    const openedBuffer = present(source.sourceBuffers[0])
    assert.deepEqual(openedBuffer.removes, [[0, 70]])

    controller.abort()
    await lifetime.return(undefined)
  },
)

test(
  "a new stream epoch aborts an incomplete parser before changing offset",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    const source = present(current.sources[0])
    const openedBuffer = present(source.sourceBuffers[0])
    assert.equal(openedBuffer.updating, false)
    assert.equal(openedBuffer.appendState, "parsing")
    assert.equal((await buffer.next(30)).done, false)
    assert.equal(openedBuffer.aborts, 1)
    assert.equal(openedBuffer.appendState, "waiting")
    assert.equal(openedBuffer.timestampOffset, 30)
    assert.equal(current.sources.length, 1)
    assert.equal(current.media.loads, 0)

    controller.abort()
    await lifetime.return(undefined)
  },
)

test(
  "a seek reopens an ended MediaSource without exposing native zero",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))
    assert.equal((await buffer.next("end")).done, false)

    const source = current.media.src
    current.media.currentTime = 30
    assert.equal((await buffer.next(30)).done, false)
    const mediaSource = present(current.sources[0])
    const openedBuffer = present(mediaSource.sourceBuffers[0])
    assert.equal(openedBuffer.aborts, 1)
    assert.deepEqual(openedBuffer.removes, [[20, 20.001]])
    assert.equal(current.media.src, source)
    assert.equal(current.media.currentTime, 30)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.length, 0)

    controller.abort()
    await lifetime.return(undefined)
  },
)

test(
  "an entered SourceBuffer mutation drains before lifetime teardown",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)

    const source = present(current.sources[0])
    const openedBuffer = present(source.sourceBuffers[0])
    openedBuffer.holdUpdate = true
    const appending = buffer.next(new Uint8Array([1]))
    while (!openedBuffer.updating) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    controller.abort()
    let closed = false
    const closing = lifetime.return(undefined).then(() => {
      closed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(closed, false)
    assert.notEqual(current.media.src, "")
    assert.equal(current.media.loads, 0)

    present(openedBuffer.releaseUpdate)()
    await appending
    await closing
    assert.equal(current.media.src, "")
    assert.equal(current.media.loads, 1)
  },
)

test(
  "a queued SourceBuffer epoch does not enter after lifetime cancellation",
  options,
  async () => {
    const current = await fixture()
    const { buffer, controller, lifetime } = await open_mse(current)
    await buffer.next(10)

    const source = present(current.sources[0])
    const openedBuffer = present(source.sourceBuffers[0])
    openedBuffer.holdUpdate = true
    const appending = buffer.next(new Uint8Array([1]))
    while (!openedBuffer.updating) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    const offsetting = buffer.next(30)
    controller.abort()
    let closed = false
    const closing = lifetime.return(undefined).then(() => {
      closed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(closed, false)
    assert.equal(openedBuffer.timestampOffset, 10)
    assert.equal(openedBuffer.aborts, 0)

    present(openedBuffer.releaseUpdate)()
    assert.equal((await appending).done, false)
    await offsetting
    await closing

    assert.equal(openedBuffer.timestampOffset, 10)
    assert.equal(openedBuffer.aborts, 0)
    assert.equal(current.media.loads, 1)
  },
)

test(
  "page state survives an event storm after SourceBuffer release",
  options,
  async () => {
    const current = await fixture()
    const { buffer, lifetime } = await open_mse(current)
    await buffer.next(10)
    await buffer.next(new Uint8Array([1]))

    const stateController = new AbortController()
    const states = current.context.player_test.page_changes(
      stateController.signal,
      10,
    )
    await states.next()
    const source = present(current.sources[0])
    const openedBuffer = present(source.sourceBuffers[0])
    await lifetime.return(undefined)
    assert.equal(openedBuffer.usable, false)

    for (let index = 0; index < 64; index += 1) {
      const position = 100 + index
      current.media.currentTime = position
      current.media.seeking = true
      const observed = states.next()
      current.media.dispatchEvent(new Event("progress"))
      current.media.dispatchEvent(new Event("timeupdate"))
      current.media.dispatchEvent(new Event("seeking"))
      const change = await nextValue({ next: () => observed })
      assert.equal(change.restart, true)
    }

    stateController.abort()
    await states.return(undefined)
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
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }
    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )

    while (requests < 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    const mediaSource = present(current.sources[0])
    while (mediaSource.sourceBuffers[0]?.buffered.length !== 1) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    const source = current.media.src
    current.media.currentTimes.length = 0
    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))

    const request = new URL(await secondRequest.promise)
    assert.equal(mediaSource.ends, 0)
    while (mediaSource.sourceBuffers[0]?.buffered.start(0) !== 110) {
      await new Promise((resolve) => setImmediate(resolve))
    }
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
      while (current.requests.length === 0) {
        await new Promise((resolve) => setImmediate(resolve))
      }
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
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      for (let position = 100; position < 164; position += 1) {
        current.media.currentTime = position
        current.media.seeking = true
        current.media.dispatchEvent(new Event("seeking"))
      }
      for (
        let turn = 0;
        turn < 128 &&
        !requests.some((url) => new URL(url).searchParams.get("t") === "163");
        turn += 1
      ) {
        await new Promise((resolve) => setImmediate(resolve))
      }

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
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
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
    const advance: Array<() => void> = []
    const requests: string[] = []
    current.context.setTimeout = (run) => {
      const timeout = setTimeout(run, 10_000)
      advance.push(() => {
        clearTimeout(timeout)
        run()
      })
      return timeout
    }
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length <= 3) {
        throw new Error("source unavailable")
      }
      succeeded.resolve()
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      for (let retry = 0; retry < 3; retry += 1) {
        while (advance.length <= retry) {
          await new Promise((resolve) => setImmediate(resolve))
        }
        present(advance[retry])()
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
    }
  },
)

test(
  "benign page activity preserves one original retry deadline",
  options,
  async () => {
    const current = await fixture()
    const requests: string[] = []
    let advance: (() => void) | undefined = undefined
    let timerCallbacks = 0
    let timerCancellations = 0
    let timers = 0
    current.context.clearTimeout = (timeout) => {
      timerCancellations += 1
      clearTimeout(timeout)
    }
    current.context.setTimeout = (run) => {
      timers += 1
      const invoke = () => {
        timerCallbacks += 1
        run()
      }
      const timeout = setTimeout(invoke, 10_000)
      advance = () => {
        clearTimeout(timeout)
        invoke()
      }
      return timeout
    }
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length === 1) {
        throw new Error("source request failed")
      }
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (timers !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      for (let event = 0; event < 64; event += 1) {
        current.media.dispatchEvent(new Event("timeupdate"))
        current.media.dispatchEvent(new Event("progress"))
        await new Promise((resolve) => setImmediate(resolve))
      }

      assert.equal(timers, 1)
      assert.equal(timerCallbacks, 0)
      assert.equal(timerCancellations, 0)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40"],
      )

      present<() => void>(advance)()
      while (requests.length !== 2) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      assert.equal(timers, 1)
      assert.equal(timerCallbacks, 1)
      assert.equal(timerCancellations, 0)
      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "40"],
      )
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "an unbuffered seek supersedes frozen network backoff immediately",
  options,
  async () => {
    const current = await fixture()
    const requests: string[] = []
    let timerCallbacks = 0
    let timerCancellations = 0
    let timers = 0
    current.context.clearTimeout = (timeout) => {
      timerCancellations += 1
      clearTimeout(timeout)
    }
    current.context.setTimeout = (run) => {
      timers += 1
      return setTimeout(() => {
        timerCallbacks += 1
        run()
      }, 10_000)
    }
    current.context.fetch = async (url, { signal }) => {
      requests.push(String(url))
      if (requests.length === 1) {
        throw new Error("source request failed")
      }
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            signal.addEventListener("abort", () => controller.close(), {
              once: true,
            })
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (timers !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      for (let turn = 0; turn < 8 && requests.length !== 2; turn += 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }

      assert.deepEqual(
        requests.map((url) => new URL(url).searchParams.get("t")),
        ["40", "110"],
      )
      assert.equal(timers, 1)
      assert.equal(timerCallbacks, 0)
      assert.equal(timerCancellations, 1)
      assert.equal(current.timeInput.value, "110")
      assert.equal(current.media.currentTime, 110)
      assert.equal(current.sources.length, 1)
      assert.equal(current.errors.length, 1)
    } finally {
      controller.abort()
      await playback
    }
  },
)

test(
  "MediaSource replacement cannot turn its native reset into a zero seek",
  options,
  async () => {
    const current = await fixture()
    const replaced = Promise.withResolvers<string>()
    const requests: string[] = []
    let activeReaders = 0
    const readersAtLoad: number[] = []
    let retryDelays = 0
    let firstResponse: ReadableStreamDefaultController<Uint8Array> | undefined =
      undefined
    current.context.setTimeout = (run) => {
      retryDelays += 1
      return setTimeout(run, 0)
    }
    current.context.fetch = async (url) => {
      requests.push(String(url))
      if (firstResponse) {
        replaced.resolve(String(url))
      }
      return {
        body: new ReadableStream({
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
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }
    const release = present(current.media.onLoad)
    current.media.onLoad = () => {
      readersAtLoad.push(activeReaders)
      release()
      current.media.currentTime = 0
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))
      current.media.dispatchEvent(new Event("timeupdate"))
    }

    const controller = new AbortController()
    const playback = current.context.player_test.playback_page(
      controller.signal,
    )
    try {
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const source = present(current.sources[0])
      present(source.sourceBuffers[0]).usable = false
      const response =
        present<ReadableStreamDefaultController<Uint8Array>>(firstResponse)
      response.enqueue(new Uint8Array([2]))

      const request = new URL(await replaced.promise)
      assert.equal(request.searchParams.get("t"), "40")
      assert.equal(current.timeInput.value, "40")
      assert.deepEqual(readersAtLoad, [0])
      assert.equal(retryDelays, 0)
      assert.equal(
        requests.some((url) => new URL(url).searchParams.get("t") === "0"),
        false,
      )
    } finally {
      controller.abort()
      await playback
    }
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
      while (current.sources[0]?.sourceBuffers[0]?.buffered.length !== 1) {
        await new Promise((resolve) => setImmediate(resolve))
      }
      const source = present(current.sources[0])
      present(source.sourceBuffers[0]).abortError = new DOMException(
        "The operation was aborted",
        "AbortError",
      )
      current.media.currentTime = 110
      current.media.seeking = true
      current.media.dispatchEvent(new Event("seeking"))

      while (current.sources.length !== 2 || current.requests.length !== 2) {
        await new Promise((resolve) => setImmediate(resolve))
      }
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

const shuffled = cases
  .map((testCase) => ({ order: crypto.randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

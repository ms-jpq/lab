import { readFile } from "node:fs/promises"
import { strict as assert } from "node:assert"
import test from "node:test"
import vm from "node:vm"

const PLAYER = new URL("player.js", import.meta.url)

class Media extends EventTarget {
  constructor() {
    super()
    this.currentTimes = []
    this._currentTime = 0
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
  }

  get currentTime() {
    return this._currentTime
  }

  /** @param {number} value */
  set currentTime(value) {
    this._currentTime = value
    this.currentTimes.push(value)
  }

  get src() {
    return this._src
  }

  /** @param {string} value */
  set src(value) {
    this._src = value
    this.currentTime = 0
  }

  load() {
    this.loads += 1
  }

  /** @param {string} name */
  removeAttribute(name) {
    if (name === "src") {
      this._src = ""
    }
  }
}

class Subtitle extends EventTarget {
  constructor() {
    super()
    this.dataset = { src: "/movie/subtitle" }
    this.sources = []
    this._src = ""
  }

  get src() {
    return this._src
  }

  /** @param {string} value */
  set src(value) {
    this._src = value
    this.sources.push(value)
  }
}

/** @param {number} position */
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
  const requests = []
  const revoked = []
  const sources = []
  const errors = []
  const window = new EventTarget()
  class SourceBuffer extends EventTarget {
    /** @param {MediaSource} source */
    constructor(source) {
      super()
      this.source = source
      this.buffered = {
        ranges: [],
        get length() {
          return this.ranges.length
        },
        start(index) {
          return this.ranges[index][0]
        },
        end(index) {
          return this.ranges[index][1]
        },
      }
      this._timestampOffset = 0
      this.holdUpdate = false
      this.releaseUpdate = undefined
      this.updating = false
    }

    get timestampOffset() {
      return this._timestampOffset
    }

    /** @param {number} value */
    set timestampOffset(value) {
      if (this.source.readyState === "ended") {
        this.source.readyState = "open"
        queueMicrotask(() => this.source.dispatchEvent(new Event("sourceopen")))
      }
      this._timestampOffset = value
    }

    abort() {
      this.updating = false
    }

    /** @param {Uint8Array} _bytes */
    appendBuffer(_bytes) {
      this.updating = true
      const complete = () => {
        this.buffered.ranges = [
          [this.timestampOffset, this.timestampOffset + 10],
        ]
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      }
      if (this.holdUpdate) {
        this.releaseUpdate = complete
      } else {
        queueMicrotask(complete)
      }
    }

    /** @param {number} start @param {number} end */
    remove(start, end) {
      if (this.source.readyState === "ended") {
        this.source.readyState = "open"
        queueMicrotask(() => this.source.dispatchEvent(new Event("sourceopen")))
      }
      this.updating = true
      queueMicrotask(() => {
        this.buffered.ranges = this.buffered.ranges.flatMap(([left, right]) =>
          right <= start || end <= left ? [[left, right]] : [],
        )
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      })
    }
  }
  class MediaSource extends EventTarget {
    constructor() {
      super()
      sources.push(this)
      this.duration = Number.NaN
      this.ends = 0
      this.readyState = "closed"
      this.sourceBuffers = []
    }

    /** @param {string} _type */
    addSourceBuffer(_type) {
      const buffer = new SourceBuffer(this)
      this.sourceBuffers.push(buffer)
      return buffer
    }

    endOfStream() {
      this.ends += 1
      this.readyState = "ended"
    }

    /** @param {SourceBuffer} buffer */
    removeSourceBuffer(buffer) {
      this.sourceBuffers = this.sourceBuffers.filter((item) => item !== buffer)
    }
  }
  class PlayerURL extends URL {
    /** @param {MediaSource} source */
    static createObjectURL(source) {
      const url = `blob:player-${crypto.randomUUID()}`
      queueMicrotask(() => {
        source.readyState = "open"
        source.dispatchEvent(new Event("sourceopen"))
      })
      return url
    }

    /** @param {string} url */
    static revokeObjectURL(url) {
      revoked.push(url)
    }
  }
  const context = vm.createContext({
    AbortController,
    AbortSignal,
    clearTimeout,
    console: {
      error: (...values) => errors.push(values),
    },
    crypto,
    document: {
      querySelector: (selector) => {
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
    fetch: async (url) => {
      requests.push(String(url))
      return {
        body: new ReadableStream({
          start: (controller) => {
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
      replaceState: (_state, _unused, url) => {
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
    setTimeout: (run) => setTimeout(run, 0),
    URL: PlayerURL,
    URLSearchParams,
    Uint8Array,
    window,
  })
  const source = await readFile(PLAYER, "utf8")
  vm.runInContext(
    `${source}\nglobalThis.player_test = { mse, page_states, playback_page, playable_position, session, source_url, stream_position }`,
    context,
  )
  const ranges = []
  const buffer = {
    available: (value) => {
      for (const [start, end] of ranges) {
        if (start <= value && value < end) {
          return value
        }
        if (value < start && start - value <= 0.1) {
          return start
        }
      }
      return undefined
    },
    contains: (value) =>
      ranges.some(([start, end]) => start <= value && value < end),
  }

  return {
    buffer,
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

/** @param {Awaited<ReturnType<typeof fixture>>} current @param {number} position */
const ready = async (current, position = 40) => {
  const controller = new AbortController()
  const states = current.context.player_test.page_states(
    controller.signal,
    current.buffer,
    position,
  )
  await states.next()
  current.ranges.push([0, 100])
  const aligned = states.next()
  current.media.dispatchEvent(new Event("canplay"))
  await aligned
  const acknowledged = states.next()
  current.media.dispatchEvent(new Event("timeupdate"))
  await acknowledged
  return { controller, states }
}

test(
  "native startup time is provisional until the requested position is buffered",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const states = current.context.player_test.page_states(
      controller.signal,
      current.buffer,
      40,
    )
    await states.next()

    const transient = states.next()
    current.media.dispatchEvent(new Event("timeupdate"))
    await transient
    assert.equal(current.timeInput.value, "40")

    current.ranges.push([40, 80])
    const aligned = states.next()
    current.media.dispatchEvent(new Event("canplay"))
    await aligned
    assert.equal(current.media.currentTime, 40)
    controller.abort()
  },
)

test(
  "a user seek supersedes an unacknowledged startup position",
  { concurrency: true },
  async () => {
    const current = await fixture(0)
    const controller = new AbortController()
    const states = current.context.player_test.page_states(
      controller.signal,
      current.buffer,
      0,
    )
    await states.next()

    current.media.currentTime = 37
    current.media.seeking = true
    const sought = states.next()
    current.media.dispatchEvent(new Event("seeking"))
    const { value } = await sought
    assert.equal(value.seek, 37)
    assert.equal(current.timeInput.value, "37")

    current.ranges.push([0, 10])
    const stale = states.next()
    current.media.dispatchEvent(new Event("canplay"))
    await stale
    assert.equal(current.media.currentTime, 37)
    controller.abort()
  },
)

for (const order of ["seeking-timeupdate", "timeupdate-seeking"]) {
  test(
    `an unbuffered seek restarts once with ${order} ordering`,
    { concurrency: true },
    async () => {
      const current = await fixture()
      const { controller, states } = await ready(current)
      current.media.currentTime = 110

      if (order === "timeupdate-seeking") {
        const observed = states.next()
        current.media.dispatchEvent(new Event("timeupdate"))
        assert.equal((await observed).value.seek, undefined)
      }

      current.media.seeking = true
      const observed = states.next()
      current.media.dispatchEvent(new Event("seeking"))
      const { value } = await observed
      assert.equal(value.seek, 110)
      assert.equal(current.timeInput.value, "110")
      controller.abort()
    },
  )
}

test(
  "a buffered seek persists without restarting",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.media.currentTime = 70
    current.media.seeking = true
    const observed = states.next()
    current.media.dispatchEvent(new Event("seeking"))
    const { value } = await observed
    assert.equal(value.seek, undefined)
    assert.equal(current.timeInput.value, "70")
    controller.abort()
  },
)

test(
  "a seek adjacent to buffered media aligns without restarting",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.ranges.length = 0
    current.ranges.push([70.05, 100])
    current.media.currentTime = 70
    current.media.seeking = true
    const observed = states.next()
    current.media.dispatchEvent(new Event("seeking"))
    const { value } = await observed
    assert.equal(value.seek, undefined)
    controller.abort()
  },
)

test(
  "ended resets resume position and exact-end startup stays playable",
  { concurrency: true },
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
  { concurrency: true },
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.media.error = { code: current.context.MediaError.MEDIA_ERR_ABORTED }
    const observed = states.next()
    current.media.dispatchEvent(new Event("error"))
    const { value } = await observed
    assert.equal(value.failed, false)
    controller.abort()
  },
)

test(
  "high water pauses one response instead of canceling and retrying",
  { concurrency: true },
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    current.media.dataset.duration = "60"
    const firstAppend = Promise.withResolvers()
    let requests = 0
    let cancellations = 0
    current.context.fetch = async () => {
      requests += 1
      return {
        body: new ReadableStream({
          start: (controller) => {
            controller.enqueue(new Uint8Array([1]))
            controller.enqueue(new Uint8Array([2]))
            controller.close()
          },
          cancel: () => {
            cancellations += 1
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }
    const controller = new AbortController()
    let appends = 0
    let ended = 0
    let offset = 0
    let released = false
    let tail = 40
    const buffer = {
      available: (position) => (tail > position ? position : undefined),
      frontier: () => tail,
      next: async (operation) => {
        if (operation === "end") {
          ended += 1
          controller.abort()
        } else if (typeof operation === "number") {
          offset = operation
        } else if (Array.isArray(operation)) {
          appends += 1
          tail = offset + appends * 10
          if (appends === 1) {
            firstAppend.resolve()
          }
        }
        return { done: false }
      },
      play_ahead: () => (appends === 1 && !released ? 60 : 0),
    }
    const playback = current.context.player_test.session(
      controller.signal,
      buffer,
      40,
    )
    const paused = playback.next()
    await firstAppend.promise
    assert.equal((await paused).done, false)
    assert.equal(requests, 1)

    released = true
    assert.equal((await playback.next()).done, true)
    assert.equal(appends, 2)
    assert.equal(cancellations, 0)
    assert.equal(ended, 1)
    assert.equal(requests, 1)
  },
)

test(
  "containment is exact and teardown releases the owned source",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const buffer = current.context.player_test.mse(
      controller.signal,
      current.media,
      10,
    )
    const opened = buffer.next()
    assert.equal(current.media.currentTime, 10)
    assert.equal((await opened).done, false)
    await buffer.next(10)
    await buffer.next([10, new Uint8Array([1])])

    assert.equal(buffer.contains(10), true)
    assert.equal(buffer.contains(9.95), false)
    assert.equal(buffer.available(9.95), 10)
    controller.abort()
    await buffer.return()
    assert.equal(current.media.src, "")
    assert.equal(current.media.loads, 1)
    assert.equal(current.revoked.length, 1)
  },
)

test(
  "a seek reopens an ended MediaSource without exposing native zero",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const buffer = current.context.player_test.mse(
      controller.signal,
      current.media,
      10,
    )
    assert.equal((await buffer.next()).done, false)
    await buffer.next(10)
    await buffer.next([10, new Uint8Array([1])])
    assert.equal((await buffer.next("end")).done, false)

    const source = current.media.src
    current.media.currentTime = 30
    assert.equal((await buffer.next(30)).done, false)
    assert.equal(current.media.src, source)
    assert.equal(current.media.currentTime, 30)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.length, 0)

    controller.abort()
    await buffer.return()
  },
)

test(
  "an entered SourceBuffer mutation drains before lifetime teardown",
  { concurrency: true, timeout: 1_000 },
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    const buffer = current.context.player_test.mse(
      controller.signal,
      current.media,
      10,
    )
    assert.equal((await buffer.next()).done, false)
    await buffer.next(10)

    const [source] = current.sources
    const [openedBuffer] = source.sourceBuffers
    openedBuffer.holdUpdate = true
    const appending = buffer.next([10, new Uint8Array([1])])
    while (!openedBuffer.updating) {
      await new Promise((resolve) => setImmediate(resolve))
    }

    controller.abort()
    let closed = false
    const closing = buffer.return().then(() => {
      closed = true
    })
    await new Promise((resolve) => setImmediate(resolve))

    assert.equal(closed, false)
    assert.notEqual(current.media.src, "")
    assert.equal(current.media.loads, 0)

    openedBuffer.releaseUpdate()
    await appending
    await closing
    assert.equal(current.media.src, "")
    assert.equal(current.media.loads, 1)
  },
)

test(
  "an ordinary unbuffered seek keeps one target request and one MediaSource",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const secondRequest = Promise.withResolvers()
    let requests = 0
    let targetSignal = undefined
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
    const [mediaSource] = current.sources
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
    assert.equal(targetSignal.aborted, false)
    assert.equal(current.sources.length, 1)
    assert.equal(current.subtitle.sources.length, 1)
    assert.equal(
      new URL(current.subtitle.sources[0]).searchParams.get("t"),
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
  "a failed target request retries on the same MediaSource",
  { concurrency: true, timeout: 1_000 },
  async () => {
    const current = await fixture()
    const retried = Promise.withResolvers()
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

import { readFile } from "node:fs/promises"
import { strict as assert } from "node:assert"
import test from "node:test"
import vm from "node:vm"

const PLAYER = new URL("player.js", import.meta.url)

class Media extends EventTarget {
  constructor() {
    super()
    this.currentTime = 0
    this.dataset = {
      duration: "200",
      mseType: 'video/mp4; codecs="avc1.640028"',
      src: "/movie/stream",
    }
    this.ended = false
    this.error = null
    this.paused = true
    this.readyState = 0
    this.seeking = false
    this._src = ""
    this.loads = 0
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
    this.ERROR = 3
    this.readyState = 0
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
      this.failNextRemove = false
      this._timestampOffset = 0
      this.updating = false
    }

    get timestampOffset() {
      return this._timestampOffset
    }

    /** @param {number} value */
    set timestampOffset(value) {
      if (this.source.readyState === "ended") {
        throw new Error("timestampOffset requires an open MediaSource")
      }
      this._timestampOffset = value
    }

    abort() {
      this.updating = false
    }

    /** @param {Uint8Array} _bytes */
    appendBuffer(_bytes) {
      this.updating = true
      queueMicrotask(() => {
        this.buffered.ranges = [
          [this.timestampOffset, this.timestampOffset + 10],
        ]
        this.updating = false
        this.dispatchEvent(new Event("updateend"))
      })
    }

    /** @param {number} start @param {number} end */
    remove(start, end) {
      if (this.failNextRemove) {
        this.failNextRemove = false
        throw new DOMException(
          "SourceBuffer is no longer usable",
          "InvalidStateError",
        )
      }
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
    console,
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
    changes: new EventTarget(),
    contains: (value) =>
      ranges.some(([start, end]) => start <= value && value < end),
  }

  return {
    buffer,
    context,
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
  current.buffer.changes.dispatchEvent(new Event("change"))
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
    current.buffer.changes.dispatchEvent(new Event("change"))
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
    assert.equal(value.restart, true)
    assert.equal(value.target, 37)
    assert.equal(current.timeInput.value, "37")

    current.ranges.push([0, 10])
    const stale = states.next()
    current.buffer.changes.dispatchEvent(new Event("change"))
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
        assert.equal((await observed).value.restart, false)
      }

      current.media.seeking = true
      const observed = states.next()
      current.media.dispatchEvent(new Event("seeking"))
      const { value } = await observed
      assert.equal(value.restart, true)
      assert.equal(value.target, 110)
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
    assert.equal(value.restart, false)
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
    assert.equal(value.restart, false)
    assert.equal(value.target, 70.05)
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
  "subtitle failure does not become media failure",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const { controller, states } = await ready(current)
    current.subtitle.readyState = current.subtitle.ERROR
    const observed = states.next()
    current.subtitle.dispatchEvent(new Event("error"))
    const { value } = await observed
    assert.equal(value.media_failed, false)
    assert.equal(value.subtitle_failed, true)
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
    assert.equal(value.media_failed, false)
    controller.abort()
  },
)

test(
  "an init-only stream fails instead of parking forever",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const operations = []
    const buffer = {
      available: () => undefined,
      contains: () => false,
      next: async (operation) => {
        assert.notEqual(
          operation,
          "end",
          "empty media must not end successfully",
        )
        operations.push(operation)
        return { done: false }
      },
      play_ahead: () => 0,
    }
    await assert.rejects(
      current.context.player_test.session(
        new AbortController().signal,
        buffer,
        40.1254,
      ),
      /stream ended before position 40\.1254 became playable/,
    )
    assert.equal(operations[0], 40.125)
    assert.equal(new URL(current.requests[0]).searchParams.get("t"), "40.125")
  },
)

test(
  "a target adjacent to the first range is playable",
  { concurrency: true },
  async () => {
    const current = await fixture()
    const controller = new AbortController()
    let appended = false
    let ended = 0
    const buffer = {
      available: (position) =>
        appended ? Math.max(position, 40.05) : undefined,
      frontier: () => 200,
      next: async (operation) => {
        if (operation === "end") {
          ended += 1
          controller.abort()
        } else if (Array.isArray(operation)) {
          appended = true
        }
        return { done: false }
      },
      play_ahead: () => 0,
    }
    await current.context.player_test.session(controller.signal, buffer, 40)
    assert.equal(ended, 1)
    assert.equal(current.requests.length, 1)
  },
)

test(
  "a short clean response continues from its frontier before EOS",
  { concurrency: true },
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    current.media.dataset.duration = "50"
    const controller = new AbortController()
    let offset = 0
    let tail = 0
    let ended = 0
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
          tail = offset + 5
        }
        return { done: false }
      },
      play_ahead: () => 0,
    }
    await current.context.player_test.session(controller.signal, buffer, 40)
    assert.equal(ended, 1)
    assert.deepEqual(
      current.requests.map((request) => new URL(request).searchParams.get("t")),
      ["40", "45"],
    )
  },
)

test(
  "a partial failed response retries from its frontier",
  { concurrency: true },
  async () => {
    const current = await fixture()
    current.media.currentTime = 40
    current.media.dataset.duration = "50"
    let response = 0
    current.context.fetch = async (url) => {
      current.requests.push(String(url))
      response += 1
      const fails = response === 1
      let pulls = 0
      return {
        body: new ReadableStream({
          pull: (controller) => {
            pulls += 1
            if (pulls === 1) {
              controller.enqueue(new Uint8Array([1]))
            } else if (fails) {
              controller.error(new Error("broken stream"))
            } else {
              controller.close()
            }
          },
        }),
        ok: true,
        status: 200,
        statusText: "OK",
      }
    }
    const controller = new AbortController()
    let offset = 0
    let tail = 0
    let ended = 0
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
          tail = offset + 5
        }
        return { done: false }
      },
      play_ahead: () => 0,
    }
    await current.context.player_test.session(controller.signal, buffer, 40)
    assert.equal(ended, 1)
    assert.deepEqual(
      current.requests.map((request) => new URL(request).searchParams.get("t")),
      ["40", "45"],
    )
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
    assert.equal(buffer.frontier(9.95), 20)

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
  "a failed eviction does not end its MSE lifetime",
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

    const sourceUrl = current.media.src
    const [source] = current.sources
    const [openedBuffer] = source.sourceBuffers
    openedBuffer.failNextRemove = true
    current.media.currentTime = 100
    assert.equal((await buffer.next([100, new Uint8Array([1])])).done, false)
    assert.equal(current.media.src, sourceUrl)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.includes(sourceUrl), false)

    controller.abort()
    await buffer.return()
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
    mediaSource.sourceBuffers[0].failNextRemove = true
    const source = current.media.src
    current.media.currentTime = 110
    current.media.seeking = true
    current.media.dispatchEvent(new Event("seeking"))

    const request = new URL(await secondRequest.promise)
    while (mediaSource.sourceBuffers[0]?.buffered.start(0) !== 110) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(request.searchParams.get("t"), "110")
    assert.equal(requests, 2)
    assert.equal(targetSignal.aborted, false)
    assert.equal(current.subtitle.sources.length, 1)
    assert.equal(
      new URL(current.subtitle.sources[0]).searchParams.get("t"),
      "0",
    )
    assert.equal(current.media.src, source)
    assert.equal(current.media.currentTime, 110)
    assert.equal(current.media.loads, 0)
    assert.equal(current.revoked.length, 0)

    controller.abort()
    await playback
  },
)

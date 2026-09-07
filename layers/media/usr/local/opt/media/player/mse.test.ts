import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { getEventListeners } from "node:events"
import nodeTest, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"

import { bond, media_source, media_sources, type Mse } from "./mse.ts"

const options = { concurrency: true, timeout: 2_000 }
const MSE_TIMEOUT = 100

const acquisitionFixture = (context: TestContext) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "MediaSource")
  const sources: EventTarget[] = []
  class Source extends EventTarget {
    constructor() {
      super()
      sources.push(this)
    }
  }
  Object.defineProperty(globalThis, "MediaSource", {
    configurable: true,
    value: Source,
  })

  let nextUrl = 0
  const revoked: string[] = []
  context.mock.method(
    URL,
    "createObjectURL",
    (_object: Blob): string => `blob:test:${nextUrl++}`,
  )
  context.mock.method(URL, "revokeObjectURL", (url: string): void => {
    revoked.push(url)
  })

  const state = { loads: 0, removals: 0 }
  const media = {
    load: (): void => {
      state.loads += 1
    },
    removeAttribute: (name: string): void => {
      if (name === "src") {
        state.removals += 1
        media.src = ""
      }
    },
    src: "",
  } as unknown as HTMLMediaElement

  return {
    media,
    restore: (): void => {
      if (descriptor) {
        Object.defineProperty(globalThis, "MediaSource", descriptor)
      } else {
        Reflect.deleteProperty(globalThis, "MediaSource")
      }
    },
    revoked,
    sources,
    state,
  }
}

const timeRanges = (...ranges: [number, number][]): TimeRanges => ({
  length: ranges.length,
  start: (index) => ranges[index]![0],
  end: (index) => ranges[index]![1],
})

const fixture = (
  buffered: TimeRanges = timeRanges(),
  failure:
    "append" | "append-sync" | "remove" | "remove-sync" | undefined = undefined,
  hold: "append" | "remove" | undefined = undefined,
  readyState: "open" | "ended" = "open",
  evict_before: () => number = () => 70,
) => {
  const controller = new AbortController()
  const mutations: unknown[] = []
  const types: string[] = []
  const entered = Promise.withResolvers<void>()
  const buffer = Object.assign(new EventTarget(), {
    abort: () => {
      mutations.push(["abort"])
      if (buffer.updating) {
        buffer.updating = false
        buffer.dispatchEvent(new Event("abort"))
        if (!hold) {
          buffer.dispatchEvent(new Event("updateend"))
        }
      }
    },
    appendBuffer: (bytes: Uint8Array<ArrayBuffer>) => {
      if (failure === "append-sync") {
        throw new DOMException("append failed", "InvalidStateError")
      }
      if (buffer.updating) {
        throw new DOMException("SourceBuffer is updating", "InvalidStateError")
      }
      mutations.push(["append", [...bytes]])
      buffer.updating = true
      entered.resolve()
      if (hold !== "append") {
        buffer.updating = false
        buffer.dispatchEvent(
          new Event(failure === "append" ? "error" : "update"),
        )
        buffer.dispatchEvent(new Event("updateend"))
      }
    },
    buffered,
    onerror: null,
    onupdateend: null,
    remove: (start: number, end: number) => {
      if (failure === "remove-sync") {
        throw new DOMException("remove failed", "InvalidStateError")
      }
      mutations.push(["remove", start, end])
      buffer.updating = true
      entered.resolve()
      if (hold !== "remove") {
        buffer.updating = false
        buffer.dispatchEvent(
          new Event(failure === "remove" ? "error" : "update"),
        )
        buffer.dispatchEvent(new Event("updateend"))
      }
    },
    timestampOffset: 0,
    updating: false,
  })
  const media = Object.assign(new EventTarget(), {
    buffered,
    currentTime: 0,
    dataset: { duration: "200" },
  }) as unknown as HTMLMediaElement
  const source = Object.assign(new EventTarget(), {
    addSourceBuffer: (type: string) => {
      types.push(type)
      return buffer
    },
    endOfStream: () => mutations.push(["end"]),
    readyState,
  })
  const values = media_source({
    evict_before,
    media,
    mime_type: "video/test",
    signal: controller.signal,
    source: source as unknown as MediaSource,
    timeout: MSE_TIMEOUT,
  })
  return {
    buffer,
    controller,
    entered: entered.promise,
    media,
    mutations,
    release: () => {
      buffer.updating = false
      buffer.dispatchEvent(new Event("update"))
      return buffer.dispatchEvent(new Event("updateend"))
    },
    source,
    types,
    values,
  }
}

const quotaFixture = (capacity = 40) => {
  const state = { start: 0, end: capacity, attempts: 0, cutoff: -20 }
  const ranges: TimeRanges = {
    get length() {
      return state.end > state.start ? 1 : 0
    },
    start: () => state.start,
    end: () => state.end,
  }
  const current = fixture(
    ranges,
    undefined,
    undefined,
    "open",
    () => state.cutoff,
  )
  const accepted: Uint8Array<ArrayBuffer>[] = []
  current.media.currentTime = 10
  current.buffer.appendBuffer = (bytes) => {
    state.attempts += 1
    if (state.end - state.start + bytes.byteLength > capacity) {
      throw new DOMException(
        "MediaSource buffer not sufficient.",
        "QuotaExceededError",
      )
    }
    accepted.push(bytes)
    state.end += bytes.byteLength
    current.release()
  }
  current.buffer.remove = (start, end) => {
    current.mutations.push(["remove", start, end])
    state.start = Math.min(state.end, end)
    current.release()
  }
  return { ...current, accepted, state }
}

const start = async (values: Mse, position = 0): Promise<void> => {
  deepEqual(await values.next(), { done: false, value: new Uint8Array(0) })
  deepEqual(await values.next(position), {
    done: false,
    value: new Uint8Array(0),
  })
}

const cases = [
  {
    name: "a committed bond releases opening listeners before handing off",
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      const owner = new AbortController()
      const values = bond(current.media, owner.signal, MSE_TIMEOUT)
      try {
        current.media.src = "blob:test:previous"
        const pending = values.next()
        const source = current.sources[0]
        assert(source)
        source.dispatchEvent(new Event("sourceopen"))
        deepEqual(await pending, { done: false, value: source })
        deepEqual(getEventListeners(source, "sourceopen"), [])
        deepEqual(getEventListeners(source, "sourceclose"), [])
        deepEqual(current.media.src, "blob:test:0")
        deepEqual(current.revoked, ["blob:test:previous"])
      } finally {
        owner.abort()
        await values.return?.()
        current.restore()
      }
    },
  },
  {
    name: "quota yields the exact unaccepted bytes without autonomous retries, eviction, or listeners",
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      const chunk = new Uint8Array(32).fill(7).subarray(6, 26)
      try {
        const outcome = await Promise.race([
          current.values.next(chunk),
          setImmediate("pending"),
        ])
        assert(typeof outcome === "object" && !outcome.done)
        assert(outcome.value === chunk)
        deepEqual(current.state.attempts, 1)
        deepEqual(current.accepted, [])
        for (let index = 0; index < 3; index += 1) {
          current.media.currentTime += 10
          current.media.dispatchEvent(new Event("timeupdate"))
          current.media.dispatchEvent(new Event("seeking"))
          await setImmediate()
        }
        deepEqual(current.state.attempts, 1)
        deepEqual(current.accepted, [])
        deepEqual(current.mutations, [])
        deepEqual(getEventListeners(current.media, "timeupdate"), [])
        deepEqual(getEventListeners(current.media, "seeking"), [])
        deepEqual(getEventListeners(current.source, "sourceclose"), [])
        deepEqual(getEventListeners(current.buffer, "update"), [])
        deepEqual(getEventListeners(current.buffer, "error"), [])
      } finally {
        current.controller.abort()
        await current.values.return?.(undefined)
      }
    },
  },
  {
    name: "retrying quota uses the configured eviction cutoff without resetting the parser",
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      const chunk = new Uint8Array(20).fill(7)
      try {
        const first = await current.values.next(chunk)
        assert(first.value === chunk)
        current.state.cutoff = 9.9
        const retry = await current.values.next(chunk)
        assert(retry.value === chunk)
        deepEqual(current.state.attempts, 2)
        deepEqual(current.accepted, [])
        current.media.currentTime = 20.5
        current.state.cutoff = 20.4
        deepEqual(await current.values.next(chunk), {
          done: false,
          value: new Uint8Array(0),
        })
        deepEqual(current.accepted, [chunk])
        assert(current.accepted[0] === chunk)
        deepEqual(current.state.attempts, 3)
        deepEqual(current.mutations, [
          ["remove", 0, 9.9],
          ["remove", 0, 20.4],
        ])
      } finally {
        current.controller.abort()
        await current.values.return?.(undefined)
      }
    },
  },
  {
    name: "abort after a quota outcome prevents a requested retry from evicting or appending",
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      const chunk = new Uint8Array(20)
      try {
        const first = await current.values.next(chunk)
        assert(first.value === chunk)
        current.controller.abort()
        deepEqual(await current.values.next(chunk), {
          done: true,
          value: undefined,
        })
        deepEqual(current.state.attempts, 1)
        deepEqual(current.accepted, [])
        deepEqual(current.mutations, [])
      } finally {
        current.controller.abort()
        await current.values.return?.(undefined)
      }
    },
  },
  {
    name: "return after a quota outcome closes without waiting for playback progress",
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      try {
        const chunk = new Uint8Array(20)
        const first = await current.values.next(chunk)
        assert(first.value === chunk)
        deepEqual(
          await Promise.race([
            current.values.return?.(undefined),
            setImmediate("pending"),
          ]),
          {
            done: true,
            value: undefined,
          },
        )
        deepEqual(current.state.attempts, 1)
        deepEqual(current.accepted, [])
      } finally {
        current.controller.abort()
        await current.values.return?.(undefined)
      }
    },
  },
  {
    name: "an oversized first chunk is yielded back without waiting for impossible playback progress",
    run: async () => {
      const current = quotaFixture(0)
      current.media.currentTime = 0
      await start(current.values)
      const chunk = new Uint8Array(20)
      const outcome = await current.values.next(chunk)
      assert(outcome.value === chunk)
      deepEqual(outcome.done, false)
      deepEqual(current.state.attempts, 1)
      deepEqual(current.accepted, [])
      await current.values.return?.(undefined)
    },
  },
  ...(["remove", "append"] as const).map((operation) => ({
    name: `${operation} errors outside synchronous append quota still escape unchanged`,
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      const chunk = new Uint8Array(20)
      if (operation === "remove") {
        const first = await current.values.next(chunk)
        assert(first.value === chunk)
        current.state.cutoff = 9.9
      }
      const failure = new DOMException(
        "operation failed",
        operation === "remove" ? "QuotaExceededError" : "InvalidStateError",
      )
      if (operation === "remove") {
        current.buffer.remove = () => {
          throw failure
        }
      } else {
        current.buffer.appendBuffer = () => {
          throw failure
        }
      }
      const outcome = await current.values.next(chunk).then(
        () => undefined,
        (error: unknown) => error,
      )
      assert(outcome === failure)
    },
  })),
  {
    name: "a new timestamp clears returned bytes without changing the configured eviction cutoff",
    run: async () => {
      const current = quotaFixture()
      await start(current.values)
      try {
        const chunk = new Uint8Array(20)
        const first = await current.values.next(chunk)
        assert(first.value === chunk)
        deepEqual(await current.values.next(120), {
          done: false,
          value: new Uint8Array(0),
        })
        const next = new Uint8Array(1)
        const second = await current.values.next(next)
        assert(second.value === next)
        deepEqual(current.mutations, [["abort"]])
        deepEqual(current.buffer.timestampOffset, 120)
      } finally {
        current.controller.abort()
        await current.values.return?.(undefined)
      }
    },
  },
  {
    name: "bond rolls back a candidate that closes before its open handoff resumes",
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      const owner = new AbortController()
      const values = bond(current.media, owner.signal, MSE_TIMEOUT)
      try {
        current.media.src = "blob:test:previous"
        const pending = values.next()
        const source = current.sources[0]
        assert(source)
        Object.assign(source, { readyState: "open" })
        source.dispatchEvent(new Event("sourceopen"))
        Object.assign(source, { readyState: "closed" })
        const detached = setImmediate().then(() =>
          source.dispatchEvent(new Event("sourceclose")),
        )
        const outcome = await pending.then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        )
        await detached

        assert("error" in outcome)
        deepEqual(current.media.src, "blob:test:previous")
        deepEqual(current.revoked, ["blob:test:0"])
        deepEqual(getEventListeners(source, "sourceopen"), [])
        deepEqual(getEventListeners(source, "sourceclose"), [])
      } finally {
        owner.abort()
        await values.return?.()
        current.restore()
      }
    },
  },
  ...(["abort", "return"] as const).map((cancellation) => ({
    name: `bond does not commit an opened source after ${cancellation} cancels its pending handoff`,
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      const owner = new AbortController()
      const values = bond(current.media, owner.signal, MSE_TIMEOUT)
      try {
        current.media.src = "blob:test:previous"
        const pending = values.next()
        const source = current.sources[0]
        assert(source)

        source.dispatchEvent(new Event("sourceopen"))
        const closing = (() => {
          switch (cancellation) {
            case "abort": {
              owner.abort()
              return undefined
            }
            case "return": {
              return values.return?.()
            }
          }
        })()
        const acquired = await pending
        await closing

        deepEqual(acquired, { done: true, value: undefined })
        deepEqual(current.media.src, "blob:test:previous")
        deepEqual(current.revoked, ["blob:test:0"])
        deepEqual(getEventListeners(source, "sourceopen"), [])
        deepEqual(getEventListeners(source, "sourceclose"), [])
      } finally {
        owner.abort()
        await values.return?.()
        current.restore()
      }
    },
  })),
  {
    name: "seeking cannot leave a successful operation's queued update behind",
    run: async () => {
      const { buffer, controller, entered, media, mutations, release, values } =
        fixture(timeRanges(), undefined, "append")
      await start(values)
      const appending = values.next(new Uint8Array([9]))
      await entered
      try {
        buffer.updating = false
        media.currentTime = 110
        media.dispatchEvent(new Event("seeking"))
        deepEqual(
          await Promise.race([
            appending.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        deepEqual(mutations, [["append", [9]]])
        release()
        await appending
        for (const type of ["update", "error"] as const) {
          deepEqual(getEventListeners(buffer, type), [])
        }
        deepEqual(getEventListeners(media, "seeking"), [])
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  },
  {
    name: "a seek storm ending in buffered media preserves the active parser",
    run: async () => {
      const { buffer, controller, entered, media, mutations, release, values } =
        fixture(timeRanges([100, 120]), undefined, "append")
      await start(values, 100)
      const appending = values.next(new Uint8Array([9]))
      await entered
      try {
        media.currentTime = 200
        media.dispatchEvent(new Event("seeking"))
        media.currentTime = 110
        media.dispatchEvent(new Event("seeking"))
        deepEqual(
          await Promise.race([
            appending.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        deepEqual(buffer.updating, true)
        deepEqual(mutations, [["append", [9]]])
        release()
        await appending
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  },
  ...[100, 99.95, 120, 120.05].map((position) => ({
    name: `a buffered seek to ${position} preserves an active parser`,
    run: async () => {
      const { buffer, controller, entered, media, mutations, release, values } =
        fixture(timeRanges([100, 120]), undefined, "append")
      await start(values, 100)
      const appending = values.next(new Uint8Array([9]))
      await entered
      try {
        media.currentTime = position
        media.dispatchEvent(new Event("seeking"))
        deepEqual(
          await Promise.race([
            appending.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        deepEqual(buffer.updating, true)
        deepEqual(mutations, [["append", [9]]])
        release()
        await appending
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  })),
  {
    name: "an ignored buffered seek still allows a later unbuffered seek to interrupt",
    run: async () => {
      const { buffer, controller, entered, media, mutations, release, values } =
        fixture(timeRanges([100, 120]), undefined, "append")
      await start(values, 100)
      const appending = values.next(new Uint8Array([9]))
      await entered
      try {
        media.currentTime = 110
        media.dispatchEvent(new Event("seeking"))
        deepEqual(
          await Promise.race([
            appending.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        deepEqual(buffer.updating, true)
        media.currentTime = 200
        media.dispatchEvent(new Event("seeking"))
        await appending
        deepEqual(buffer.updating, false)
        deepEqual(mutations, [["append", [9]], ["abort"]])
        deepEqual(getEventListeners(media, "seeking"), [])
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  },
  ...(["abort", "seeking", "timeout"] as const).map((interruption) => ({
    name: `range removal survives ${interruption} without calling the forbidden SourceBuffer abort`,
    run: async (context: TestContext) => {
      const { buffer, controller, entered, media, release, values } = fixture(
        timeRanges([0, 120]),
        undefined,
        "remove",
      )
      context.mock.method(buffer, "abort", () => {
        if (buffer.updating) {
          throw new DOMException(
            "Range removal is running",
            "InvalidStateError",
          )
        }
      })
      await start(values)
      const appending = values.next(new Uint8Array([9])).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      )
      await entered
      try {
        switch (interruption) {
          case "abort": {
            controller.abort()
            break
          }
          case "seeking": {
            media.dispatchEvent(new Event("seeking"))
            await setImmediate()
            release()
            break
          }
          case "timeout": {
            break
          }
        }
        const outcome = await appending
        if (interruption === "timeout") {
          assert("error" in outcome)
          assert(outcome.error instanceof Error)
          deepEqual(outcome.error.message, "SourceBuffer operation timed out")
        } else {
          assert(
            "result" in outcome,
            "interruption must not fail with InvalidStateError",
          )
        }
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  })),
  {
    name: "an aborted append's queued updateend does not finish the next append",
    run: async () => {
      const { buffer, controller, entered, media, release, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)
      try {
        const first = values.next(new Uint8Array([1]))
        await entered
        media.currentTime = 110
        media.dispatchEvent(new Event("seeking"))
        await first
        deepEqual(buffer.updating, false)

        const second = values.next(new Uint8Array([2]))
        await setImmediate()
        deepEqual(buffer.updating, true)
        buffer.dispatchEvent(new Event("updateend"))
        deepEqual(
          await Promise.race([
            second.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        release()
        await second
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  },
  {
    name: "an aborted append's queued updateend cannot hide a later append error",
    run: async () => {
      const { buffer, controller, entered, media, release, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)
      try {
        const first = values.next(new Uint8Array([1]))
        await entered
        media.currentTime = 110
        media.dispatchEvent(new Event("seeking"))
        await first

        const second = values.next(new Uint8Array([2])).then(
          (result) => ({ result }),
          (error: unknown) => ({ error }),
        )
        await setImmediate()
        buffer.updating = false
        buffer.dispatchEvent(new Event("updateend"))
        deepEqual(
          await Promise.race([
            second.then(() => "completed"),
            setImmediate("pending"),
          ]),
          "pending",
        )
        const failure = new Event("error")
        buffer.dispatchEvent(failure)
        buffer.dispatchEvent(new Event("updateend"))
        deepEqual(await second, { error: failure })
      } finally {
        controller.abort()
        release()
        await values.return?.(undefined)
      }
    },
  },
  {
    name: "a pre-aborted MSE performs no work",
    run: async () => {
      const { controller, mutations, types, values } = fixture()
      controller.abort()

      deepEqual(await values.next(), { done: true, value: undefined })
      deepEqual(mutations, [])
      deepEqual(types, [])
    },
  },
  {
    name: "MSE observes a synchronous append completion",
    run: async () => {
      const { mutations, types, values } = fixture()

      await start(values)
      deepEqual(await values.next(new Uint8Array([1, 2])), {
        done: false,
        value: new Uint8Array(0),
      })
      deepEqual(mutations, [["append", [1, 2]]])
      deepEqual(types, ["video/test"])

      const closed = values.return?.(undefined)
      assert(closed)
      await closed
    },
  },
  {
    name: "MSE evicts expired media before appending",
    run: async () => {
      const { mutations, values } = fixture(timeRanges([0, 120]))

      await start(values)
      await values.next(new Uint8Array([3]))

      deepEqual(mutations, [
        ["remove", 0, 70],
        ["append", [3]],
      ])
      const closed = values.return?.(undefined)
      assert(closed)
      await closed
    },
  },
  {
    name: "MSE surfaces a SourceBuffer mutation error",
    run: async () => {
      const { values } = fixture(timeRanges(), "append")
      await start(values)

      const failure = await values.next(new Uint8Array([4])).then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof Event)
      deepEqual(failure.type, "error")
    },
  },
  {
    name: "MSE surfaces a synchronous append failure without waiting",
    run: async () => {
      const { values } = fixture(timeRanges(), "append-sync")
      await start(values)

      const failure = await Promise.race([
        values.next(new Uint8Array([4])).then(
          () => undefined,
          (error: unknown) => error,
        ),
        setImmediate("pending"),
      ])

      assert(failure instanceof DOMException)
      deepEqual(failure.name, "InvalidStateError")
    },
  },
  {
    name: "MSE surfaces a synchronous removal failure without waiting",
    run: async () => {
      const { values } = fixture(timeRanges([0, 120]), "remove-sync")
      await start(values)

      const failure = await Promise.race([
        values.next(new Uint8Array([4])).then(
          () => undefined,
          (error: unknown) => error,
        ),
        setImmediate("pending"),
      ])

      assert(failure instanceof DOMException)
      deepEqual(failure.name, "InvalidStateError")
    },
  },
  {
    name: "MSE surfaces an asynchronous removal failure before appending",
    run: async () => {
      const { mutations, values } = fixture(timeRanges([0, 120]), "remove")
      await start(values)

      const failure = await values.next(new Uint8Array([4])).then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof Event)
      deepEqual(failure.type, "error")
      deepEqual(mutations, [["remove", 0, 70]])
    },
  },
  {
    name: "MSE aborts and surfaces a stalled SourceBuffer mutation",
    run: async () => {
      const { buffer, mutations, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)

      const failure = await values.next(new Uint8Array([4])).then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof Error)
      deepEqual(failure.message, "SourceBuffer operation timed out")
      deepEqual(mutations, [["append", [4]], ["abort"]])
      deepEqual(buffer.updating, false)
    },
  },
  {
    name: "return drains an entered SourceBuffer mutation",
    run: async () => {
      const { entered, mutations, release, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)

      const appending = values.next(new Uint8Array([5]))
      await entered
      const closing = values.return?.(undefined)
      assert(closing)

      const closed = await Promise.race([
        closing.then(() => true),
        setImmediate(false),
      ])
      deepEqual(closed, false)

      release()
      deepEqual(await appending, { done: false, value: new Uint8Array(0) })
      deepEqual(await closing, { done: true, value: undefined })
      deepEqual(mutations, [["append", [5]]])
    },
  },
  {
    name: "parent abort interrupts an entered SourceBuffer mutation",
    run: async () => {
      const { buffer, controller, entered, mutations, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)
      const appending = values.next(new Uint8Array([6]))
      await entered
      const closing = values.return?.(undefined)
      assert(closing)

      controller.abort()

      deepEqual(
        await Promise.race([
          Promise.all([appending, closing]),
          setImmediate("pending"),
        ]),
        [
          { done: false, value: new Uint8Array(0) },
          { done: true, value: undefined },
        ],
      )
      deepEqual(mutations, [["append", [6]], ["abort"]])
      deepEqual(buffer.updating, false)
    },
  },
  {
    name: "parent abort interrupts an entered SourceBuffer removal",
    run: async () => {
      const { buffer, controller, entered, mutations, values } = fixture(
        timeRanges([0, 120]),
        undefined,
        "remove",
      )
      await start(values)
      const appending = values.next(new Uint8Array([6]))
      await entered
      const closing = values.return?.(undefined)
      assert(closing)

      controller.abort()

      deepEqual(
        await Promise.race([
          Promise.all([appending, closing]),
          setImmediate("pending"),
        ]),
        [
          { done: false, value: new Uint8Array(0) },
          { done: true, value: undefined },
        ],
      )
      deepEqual(mutations, [["remove", 0, 70]])
      deepEqual(buffer.updating, true)
    },
  },
  {
    name: "a second timestamp resets the parser before changing its offset",
    run: async () => {
      const { buffer, mutations, values } = fixture()
      await start(values, 10)
      deepEqual(buffer.timestampOffset, 10)
      deepEqual(mutations, [])

      await values.next(30)
      deepEqual(mutations, [["abort"]])
      deepEqual(buffer.timestampOffset, 30)
      await values.return?.(undefined)
    },
  },
  {
    name: "abort during reopening does not reset a parser while removal is running",
    run: async () => {
      const { buffer, controller, entered, mutations, values } = fixture(
        timeRanges([0, 20]),
        undefined,
        "remove",
        "ended",
      )
      await start(values, 10)
      const reopening = values.next(30)
      await entered
      controller.abort()

      deepEqual(await Promise.race([reopening, setImmediate("pending")]), {
        done: true,
        value: undefined,
      })
      deepEqual(mutations, [["remove", 20, 20.001]])
      deepEqual(buffer.timestampOffset, 10)
      deepEqual(buffer.updating, true)
      await values.return?.(undefined)
    },
  },
  {
    name: "an ended source reopens before resetting its timestamp",
    run: async () => {
      const { buffer, mutations, values } = fixture(
        timeRanges([0, 20]),
        undefined,
        undefined,
        "ended",
      )
      await start(values, 10)

      await values.next(30)
      deepEqual(mutations, [["remove", 20, 20.001], ["abort"]])
      deepEqual(buffer.timestampOffset, 30)
      await values.return?.(undefined)
    },
  },
  {
    name: "end-of-stream follows the final settled append",
    run: async () => {
      const { mutations, values } = fixture()
      await start(values)

      await values.next(new Uint8Array([7]))
      deepEqual(await values.next(undefined), {
        done: false,
        value: new Uint8Array(0),
      })
      deepEqual(mutations, [["append", [7]], ["end"]])
      await values.return?.(undefined)
    },
  },
  {
    name: "queued end-of-stream waits for an entered append",
    run: async () => {
      const { entered, mutations, release, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)

      const appending = values.next(new Uint8Array([8]))
      await entered
      const ending = values.next(undefined)

      const ended = await Promise.race([
        ending.then(() => true),
        setImmediate(false),
      ])
      deepEqual(ended, false)
      deepEqual(mutations, [["append", [8]]])

      release()
      await appending
      await ending
      deepEqual(mutations, [["append", [8]], ["end"]])
      await values.return?.(undefined)
    },
  },
  {
    name: "a failed bond restores the previous URL and detaches its listeners",
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      try {
        current.media.src = "blob:test:previous"
        const owner = new AbortController()
        const values = bond(current.media, owner.signal, MSE_TIMEOUT)
        const pending = values.next()
        const source = current.sources[0]
        assert(source)

        deepEqual(getEventListeners(source, "sourceopen").length, 1)
        deepEqual(getEventListeners(source, "sourceclose").length, 1)
        source.dispatchEvent(new Event("sourceclose"))
        const failure = await pending.then(
          () => undefined,
          (error: unknown) => error,
        )

        assert(failure instanceof Event)
        deepEqual(failure.type, "sourceclose")
        deepEqual(current.media.src, "blob:test:previous")
        deepEqual(current.revoked, ["blob:test:0"])
        deepEqual(getEventListeners(source, "sourceopen").length, 0)
        deepEqual(getEventListeners(source, "sourceclose").length, 0)
      } finally {
        current.restore()
      }
    },
  },
  {
    name: "bond and media source acquisition obey their return contract",
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      try {
        const bondOwner = new AbortController()
        const bonded = bond(current.media, bondOwner.signal, MSE_TIMEOUT)
        const pendingBond = bonded.next()
        const abortedBond = bonded.return?.()
        assert(abortedBond)

        deepEqual(
          await Promise.race([
            Promise.all([pendingBond, abortedBond]),
            setImmediate("pending"),
          ]),
          [
            { done: true, value: undefined },
            { done: true, value: undefined },
          ],
        )
        deepEqual(current.sources.length, 1)
        current.media.src = ""

        const sourcesOwner = new AbortController()
        const sources = media_sources({
          evict_behind: 30,
          media: current.media,
          mime_type: "video/test",
          signal: sourcesOwner.signal,
          timeout: MSE_TIMEOUT,
        })
        const pendingSources = sources.next()
        const abortedSources = sources.return?.()
        assert(abortedSources)

        deepEqual(
          await Promise.race([
            Promise.all([pendingSources, abortedSources]),
            setImmediate("pending"),
          ]),
          [
            { done: true, value: undefined },
            { done: true, value: undefined },
          ],
        )
        deepEqual(current.revoked, ["blob:test:0", "blob:test:1"])
        deepEqual(current.state, { loads: 1, removals: 3 })
        const returnedBondOwner = new AbortController()
        const returnedBond = bond(
          current.media,
          returnedBondOwner.signal,
          MSE_TIMEOUT,
        )
        const returnedBondPending = returnedBond.next()
        const bondSource = current.sources[2]
        assert(bondSource)
        deepEqual(getEventListeners(bondSource, "sourceopen").length, 1)
        deepEqual(getEventListeners(bondSource, "sourceclose").length, 1)
        bondSource.dispatchEvent(new Event("sourceopen"))
        deepEqual(await returnedBondPending, {
          done: false,
          value: bondSource,
        })
        deepEqual(getEventListeners(bondSource, "sourceopen").length, 0)
        deepEqual(getEventListeners(bondSource, "sourceclose").length, 0)
        const closedBond = returnedBond.return?.()
        assert(closedBond)

        deepEqual(await Promise.race([closedBond, setImmediate("pending")]), {
          done: true,
          value: undefined,
        })
        current.media.src = ""

        const returnedSourcesOwner = new AbortController()
        const returnedSources = media_sources({
          evict_behind: 30,
          media: current.media,
          mime_type: "video/test",
          signal: returnedSourcesOwner.signal,
          timeout: MSE_TIMEOUT,
        })
        const returnedSourcesPending = returnedSources.next()
        const mediaSource = current.sources[3]
        assert(mediaSource)
        mediaSource.dispatchEvent(new Event("sourceopen"))
        const acquired = await returnedSourcesPending
        assert(!acquired.done)
        deepEqual(acquired.value[0], mediaSource)
        const closedSources = returnedSources.return?.()
        assert(closedSources)

        deepEqual(
          await Promise.race([closedSources, setImmediate("pending")]),
          { done: true, value: undefined },
        )
        deepEqual(current.revoked, [
          "blob:test:0",
          "blob:test:1",
          "blob:test:3",
        ])
        deepEqual(current.state, { loads: 2, removals: 4 })
      } finally {
        current.restore()
      }
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

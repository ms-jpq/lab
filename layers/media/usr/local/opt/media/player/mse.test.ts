import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"

import { bond, media_source, media_sources, type Mse } from "./mse.ts"

const options = { concurrency: true, timeout: 2_000 }

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
          new Event(failure === "append" ? "error" : "updateend"),
        )
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
          new Event(failure === "remove" ? "error" : "updateend"),
        )
      }
    },
    timestampOffset: 0,
    updating: false,
  })
  const source = {
    addSourceBuffer: (type: string) => {
      types.push(type)
      return buffer
    },
    endOfStream: () => mutations.push(["end"]),
    readyState,
  }
  const values = media_source({
    evict_before: () => 70,
    mime_type: "video/test",
    signal: controller.signal,
    source: source as unknown as MediaSource,
  })
  return {
    buffer,
    controller,
    entered: entered.promise,
    mutations,
    release: () => {
      buffer.updating = false
      return buffer.dispatchEvent(new Event("updateend"))
    },
    types,
    values,
  }
}

const start = async (values: Mse, position = 0): Promise<void> => {
  deepEqual(await values.next(), { done: false, value: undefined })
  deepEqual(await values.next(position), { done: false, value: undefined })
}

const cases = [
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
        value: undefined,
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
      deepEqual(await appending, { done: false, value: undefined })
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

      controller.abort()

      deepEqual(await Promise.race([appending, setImmediate("pending")]), {
        done: false,
        value: undefined,
      })
      deepEqual(mutations, [["append", [6]], ["abort"]])
      deepEqual(buffer.updating, false)
      deepEqual(await values.return?.(undefined), {
        done: true,
        value: undefined,
      })
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

      controller.abort()

      deepEqual(await Promise.race([appending, setImmediate("pending")]), {
        done: false,
        value: undefined,
      })
      deepEqual(mutations, [["remove", 0, 70], ["abort"]])
      deepEqual(buffer.updating, false)
      deepEqual(await values.return?.(undefined), {
        done: true,
        value: undefined,
      })
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
        value: undefined,
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
    name: "bond and media source acquisition obey their abort contract",
    run: async (context: TestContext) => {
      const current = acquisitionFixture(context)
      try {
        const bondOwner = new AbortController()
        const bonded = bond(current.media, bondOwner.signal)
        const pendingBond = bonded.next()

        bondOwner.abort()

        deepEqual(await Promise.race([pendingBond, setImmediate("pending")]), {
          done: true,
          value: undefined,
        })
        deepEqual(current.sources.length, 1)
        await bonded.return?.()
        current.media.src = ""

        const sourcesOwner = new AbortController()
        const sources = media_sources({
          evict_behind: 30,
          media: current.media,
          mime_type: "video/test",
          signal: sourcesOwner.signal,
        })
        const pendingSources = sources.next()

        sourcesOwner.abort()

        deepEqual(
          await Promise.race([pendingSources, setImmediate("pending")]),
          { done: true, value: undefined },
        )
        deepEqual(current.revoked, ["blob:test:1"])
        deepEqual(current.state, { loads: 1, removals: 1 })
        await sources.return?.()

        const returnedBondOwner = new AbortController()
        const returnedBond = bond(current.media, returnedBondOwner.signal)
        const returnedBondPending = returnedBond.next()
        const bondSource = current.sources[2]
        assert(bondSource)
        bondSource.dispatchEvent(new Event("sourceopen"))
        deepEqual(await returnedBondPending, {
          done: false,
          value: bondSource,
        })
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
        deepEqual(current.revoked, ["blob:test:1", "blob:test:3"])
        deepEqual(current.state, { loads: 2, removals: 2 })
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

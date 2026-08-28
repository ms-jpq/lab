import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"
import { setImmediate } from "node:timers/promises"

import { media_source, type Mse } from "./mse.ts"

const options = { concurrency: true, timeout: 2_000 }

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
  cancelOnAbort = false,
  cancelOnObserve = false,
) => {
  const mutations: unknown[] = []
  const types: string[] = []
  const entered = Promise.withResolvers<void>()
  const lifetime = new AbortController()
  const observation = { cancel: cancelOnObserve }
  const buffer = Object.assign(new EventTarget(), {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean,
    ) => {
      EventTarget.prototype.addEventListener.call(
        buffer,
        type,
        listener,
        options,
      )
      if (observation.cancel) {
        observation.cancel = false
        lifetime.abort()
      }
    },
    abort: () => {
      mutations.push(["abort"])
      if (cancelOnAbort) {
        lifetime.abort()
      }
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
    signal: lifetime.signal,
    source: source as unknown as MediaSource,
  })
  return {
    buffer,
    entered: entered.promise,
    lifetime,
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
    name: "lifetime cancellation prevents initial position entry",
    run: async () => {
      const { buffer, lifetime, values } = fixture()
      await values.next()

      lifetime.abort()
      const positioning = values.next(10)

      deepEqual(await positioning, { done: true, value: undefined })
      deepEqual(buffer.timestampOffset, 0)
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
    name: "lifetime cancellation aborts an entered SourceBuffer mutation",
    run: async () => {
      const { entered, lifetime, mutations, values } = fixture(
        timeRanges(),
        undefined,
        "append",
      )
      await start(values)

      const appending = values.next(new Uint8Array([5]))
      await entered
      lifetime.abort()
      deepEqual(await appending, { done: true, value: undefined })
      deepEqual(mutations, [["append", [5]], ["abort"]])
      await values.return?.(undefined)
    },
  },
  {
    name: "lifetime cancellation prevents append entry",
    run: async () => {
      const { mutations, values } = fixture(
        timeRanges(),
        undefined,
        undefined,
        "open",
        false,
        true,
      )
      await start(values)

      const appending = values.next(new Uint8Array([5]))

      deepEqual(await appending, { done: true, value: undefined })
      deepEqual(mutations, [])
    },
  },
  {
    name: "lifetime cancellation drains an entered eviction before stopping",
    run: async () => {
      const { entered, lifetime, mutations, release, values } = fixture(
        timeRanges([0, 120]),
        undefined,
        "remove",
      )
      await start(values)

      const appending = values.next(new Uint8Array([6]))
      await entered
      lifetime.abort()

      const stopped = await Promise.race([
        appending.then(
          () => true,
          () => true,
        ),
        setImmediate(false),
      ])
      deepEqual(stopped, false)

      release()
      deepEqual(await appending, { done: true, value: undefined })
      deepEqual(mutations, [["remove", 0, 70]])
    },
  },
  {
    name: "lifetime cancellation prevents eviction entry",
    run: async () => {
      const { mutations, values } = fixture(
        timeRanges([0, 120]),
        undefined,
        undefined,
        "open",
        false,
        true,
      )
      await start(values)

      const appending = values.next(new Uint8Array([6]))

      deepEqual(await appending, { done: true, value: undefined })
      deepEqual(mutations, [])
    },
  },
  {
    name: "lifetime cancellation is observed after reopening an ended source",
    run: async () => {
      const { entered, lifetime, mutations, release, values } = fixture(
        timeRanges([0, 20]),
        undefined,
        "remove",
        "ended",
      )
      await start(values, 10)

      const seeking = values.next(30)
      await entered
      lifetime.abort()

      const stopped = await Promise.race([
        seeking.then(() => true),
        setImmediate(false),
      ])
      deepEqual(stopped, false)

      release()
      deepEqual(await seeking, { done: true, value: undefined })
      deepEqual(mutations, [["remove", 20, 20.001], ["abort"]])
    },
  },
  {
    name: "lifetime cancellation prevents ended-source removal entry",
    run: async () => {
      const { buffer, mutations, values } = fixture(
        timeRanges([0, 20]),
        undefined,
        undefined,
        "ended",
        false,
        true,
      )
      await start(values, 10)

      const seeking = values.next(30)

      deepEqual(await seeking, { done: true, value: undefined })
      deepEqual(mutations, [["abort"]])
      deepEqual(buffer.timestampOffset, 10)
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
    name: "parser reset cancellation prevents a timestamp write",
    run: async () => {
      const { buffer, mutations, values } = fixture(
        timeRanges(),
        undefined,
        undefined,
        "open",
        true,
      )
      await start(values, 10)

      deepEqual(await values.next(30), { done: true, value: undefined })
      deepEqual(mutations, [["abort"]])
      deepEqual(buffer.timestampOffset, 10)
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
    name: "lifetime cancellation prevents end-of-stream entry",
    run: async () => {
      const { lifetime, mutations, values } = fixture()
      await start(values)
      lifetime.abort()

      deepEqual(await values.next(undefined), {
        done: true,
        value: undefined,
      })
      deepEqual(mutations, [])
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

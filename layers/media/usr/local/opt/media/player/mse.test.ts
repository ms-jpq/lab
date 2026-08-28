import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"
import { setImmediate } from "node:timers/promises"

import { media_source } from "./mse.ts"

const options = { concurrency: true, timeout: 2_000 }

const timeRanges = (...ranges: [number, number][]): TimeRanges => ({
  length: ranges.length,
  start: (index) => ranges[index]![0],
  end: (index) => ranges[index]![1],
})

const fixture = (
  buffered: TimeRanges = timeRanges(),
  failure: "append" | undefined = undefined,
  hold = false,
) => {
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
      mutations.push(["append", [...bytes]])
      buffer.updating = true
      entered.resolve()
      if (!hold) {
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
      mutations.push(["remove", start, end])
      buffer.updating = true
      buffer.updating = false
      buffer.dispatchEvent(new Event("updateend"))
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
    readyState: "open",
  }
  const lifetime = new AbortController()
  const values = media_source({
    evict_before: () => 70,
    mime_type: "video/test",
    signal: lifetime.signal,
    source: source as unknown as MediaSource,
  })
  return {
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

const cases = [
  {
    name: "MSE observes a synchronous append completion",
    run: async () => {
      const { mutations, types, values } = fixture()

      deepEqual(await values.next(), { done: false, value: undefined })
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

      await values.next()
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
      await values.next()

      const failure = await values.next(new Uint8Array([4])).then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof Event)
      deepEqual(failure.type, "error")
    },
  },
  {
    name: "an entered SourceBuffer mutation drains before lifetime teardown",
    run: async () => {
      const { entered, lifetime, release, values } = fixture(
        timeRanges(),
        undefined,
        true,
      )
      await values.next()

      const appending = values.next(new Uint8Array([5]))
      await entered
      lifetime.abort()
      deepEqual(mutations, [["append", [5]], ["abort"]])

      const closed = await Promise.race([
        appending.then(() => true),
        setImmediate(false),
      ])
      deepEqual(closed, false)

      release()
      await appending
      await values.return?.(undefined)
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"

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
) => {
  const mutations: unknown[] = []
  const types: string[] = []
  const buffer = Object.assign(new EventTarget(), {
    abort: () => mutations.push(["abort"]),
    appendBuffer: (bytes: Uint8Array<ArrayBuffer>) => {
      mutations.push(["append", [...bytes]])
      buffer.dispatchEvent(
        new Event(failure === "append" ? "error" : "updateend"),
      )
    },
    buffered,
    onerror: null,
    onupdateend: null,
    remove: (start: number, end: number) => {
      mutations.push(["remove", start, end])
      buffer.dispatchEvent(new Event("updateend"))
    },
    timestampOffset: 0,
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
  return { lifetime, mutations, types, values }
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
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

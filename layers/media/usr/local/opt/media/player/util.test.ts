import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"

import { events, readableIterator } from "./util.ts"

const options = { concurrency: true, timeout: 2_000 }

const cases = [
  {
    name: "a readable iterator cancels its reader when iteration ends",
    run: async () => {
      const state = { cancellations: 0 }
      const values = readableIterator(
        new ReadableStream<number>({
          start: (controller) => controller.enqueue(1),
          cancel: () => {
            state.cancellations += 1
          },
        }),
      )

      deepEqual(await values.next(), { done: false, value: 1 })
      const closed = values.return?.(undefined)
      assert(closed)
      await closed
      deepEqual(state.cancellations, 1)
    },
  },
  {
    name: "an event is delivered through the event stream",
    run: async () => {
      const owner = new AbortController()
      const target = new AbortController()
      const values = events(owner.signal, target.signal, "abort")
      const received = values.next()

      target.abort()

      const result = await received
      deepEqual(result.done, false)
      deepEqual(result.value?.type, "abort")
      owner.abort()
      deepEqual(await values.next(), { done: true, value: undefined })
    },
  },
  {
    name: "parent abort completes a pending event read",
    run: async () => {
      const owner = new AbortController()
      const target = new AbortController()
      const values = events(owner.signal, target.signal, "abort")
      const pending = values.next()

      owner.abort()

      deepEqual(await pending, { done: true, value: undefined })
    },
  },
  {
    name: "a pre-aborted parent produces an empty event stream",
    run: async () => {
      const owner = new AbortController()
      const target = new AbortController()
      owner.abort()

      const values = events(owner.signal, target.signal, "abort")

      deepEqual(await values.next(), { done: true, value: undefined })
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

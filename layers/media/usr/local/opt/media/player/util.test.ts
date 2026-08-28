import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"

import { events, merge, readableIterator } from "./util.ts"

const options = { concurrency: true, timeout: 2_000 }

const delayed = async function* (
  value: Promise<number>,
): AsyncGenerator<number> {
  yield await value
  return
}

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
  {
    name: "merged iterators preserve the losing pending read",
    run: async () => {
      const left = Promise.withResolvers<number>()
      const right = Promise.withResolvers<number>()
      const leftValues = delayed(left.promise)
      const rightValues = delayed(right.promise)
      const values = merge(leftValues, rightValues)
      const first = values.next()

      right.resolve(2)
      deepEqual(await first, { done: false, value: [rightValues, 2] })

      const second = values.next()
      left.resolve(1)
      deepEqual(await second, { done: false, value: [leftValues, 1] })
      deepEqual(await values.next(), { done: true, value: undefined })
    },
  },
  {
    name: "merge preserves each source's value type",
    run: async () => {
      const numbers = delayed(Promise.resolve(1))
      const dogs = (async function* (): AsyncGenerator<string> {
        yield "dog"
        return
      })()
      const values: AsyncIteratorObject<
        [typeof numbers, number] | [typeof dogs, string]
      > = merge(numbers, dogs)

      const result = await values.next()
      assert(!result.done)
      deepEqual(
        result.value,
        result.value[0] === numbers ? [numbers, 1] : [dogs, "dog"],
      )
      await values.return?.(undefined)
    },
  },
  {
    name: "ending a merge closes every active iterator",
    run: async () => {
      const state = { left: false, right: false }
      const tracked = async function* (
        value: number,
        side: keyof typeof state,
      ): AsyncGenerator<number> {
        try {
          yield value
        } finally {
          state[side] = true
        }
        return
      }
      const left = tracked(1, "left")
      const right = tracked(2, "right")
      const values = merge(left, right)

      deepEqual(await values.next(), { done: false, value: [left, 1] })
      const closed = values.return?.(undefined)
      assert(closed)
      await closed

      deepEqual(state, { left: true, right: true })
    },
  },
  {
    name: "merge reports every iterator close failure",
    run: async () => {
      const left = new Error("left")
      const right = new Error("right")
      const failing = (value: number, error: Error): AsyncIterator<number> => ({
        next: async () => ({ done: false, value }),
        return: async () => {
          throw error
        },
      })
      const leftValues = failing(1, left)
      const rightValues = failing(2, right)
      const values = merge(leftValues, rightValues)

      deepEqual(await values.next(), {
        done: false,
        value: [leftValues, 1],
      })
      const closed = values.return?.(undefined)
      assert(closed)
      const failure = await closed.then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof AggregateError)
      deepEqual(failure.errors, [left, right])
    },
  },
  {
    name: "merge preserves a source failure when closing also fails",
    run: async () => {
      const sourceFailure = new Error("source")
      const closeFailure = new Error("close")
      const values = merge({
        next: async (): Promise<IteratorResult<number>> => {
          throw sourceFailure
        },
        return: async (): Promise<IteratorResult<number>> => {
          throw closeFailure
        },
      })

      const failure = await values.next().then(
        () => undefined,
        (error: unknown) => error,
      )

      assert(failure instanceof SuppressedError)
      assert(failure.error instanceof AggregateError)
      deepEqual(failure.error.errors, [closeFailure])
      deepEqual(failure.suppressed, sourceFailure)
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

import { deepEqual, ok as assert } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { getEventListeners } from "node:events"
import nodeTest, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"

import {
  delay,
  event_batches,
  events,
  logical_stream,
  merge,
  once,
  readableIterator,
} from "./util.ts"

const options = { concurrency: true, timeout: 2_000 }

let fetchTests = Promise.resolve()
const withFetch = async (
  context: TestContext,
  run: () => Promise<void>,
): Promise<void> => {
  const previous = fetchTests
  const current = Promise.withResolvers<void>()
  fetchTests = previous.then(() => current.promise)
  await previous
  try {
    await run()
  } finally {
    context.mock.restoreAll()
    current.resolve()
  }
}

const delayed = async function* (
  value: Promise<number>,
): AsyncGenerator<number> {
  yield await value
  return
}

class ChangeTarget extends EventTarget {
  onchange: ((event: Event) => unknown) | null = null
  deliveries = 0

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const tracked = (event: Event): void => {
      this.deliveries += 1
      if (typeof listener === "function") {
        listener.call(this, event)
      } else {
        listener?.handleEvent(event)
      }
    }
    super.addEventListener(type, tracked, options)
  }
}

class OnceTarget extends EventTarget {
  onleft: ((event: Event) => unknown) | null = null
  onright: ((event: Event) => unknown) | null = null
  state = 0
}

const cases = [
  {
    name: "delay resolves true when its timer wins",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const removed = context.mock.method(owner.signal, "removeEventListener")
      const elapsed = delay(owner.signal, 100)

      context.mock.timers.tick(100)

      deepEqual(await elapsed, true)
      deepEqual(removed.mock.callCount(), 1)
    },
  },
  {
    name: "delay resolves false and clears its timer when abort wins",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const removed = context.mock.method(owner.signal, "removeEventListener")
      const elapsed = delay(owner.signal, 100)

      owner.abort()

      deepEqual(await elapsed, false)
      context.mock.timers.tick(100)
      deepEqual(removed.mock.callCount(), 0)
    },
  },
  {
    name: "delay resolves false without scheduling for a pre-aborted owner",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const scheduled = context.mock.method(globalThis, "setTimeout")
      const owner = new AbortController()
      owner.abort()
      const added = context.mock.method(owner.signal, "addEventListener")

      deepEqual(await delay(owner.signal, 100), false)
      deepEqual(scheduled.mock.callCount(), 0)
      deepEqual(added.mock.callCount(), 0)
    },
  },
  {
    name: "named events drain as one FIFO batch with per-event snapshots",
    run: async () => {
      const owner = new AbortController()
      const target = new OnceTarget()
      const values = event_batches(
        owner.signal,
        target,
        ["left", "right"],
        () => target.state,
      )
      const pending = values.next()

      target.state = 1
      target.dispatchEvent(new Event("left"))
      target.state = 2
      target.dispatchEvent(new Event("right"))

      const received = await pending
      assert(!received.done)
      deepEqual(
        received.value.map(([snapshot, event]) => [snapshot, event.type]),
        [
          [1, "left"],
          [2, "right"],
        ],
      )
      await values.return?.(undefined)
      deepEqual(getEventListeners(target, "left").length, 0)
      deepEqual(getEventListeners(target, "right").length, 0)
    },
  },
  {
    name: "once detaches its listener when its event wins",
    run: async () => {
      const owner = new AbortController()
      const target = new OnceTarget()
      const selected = once(owner.signal, target, "left")

      deepEqual(getEventListeners(target, "left").length, 1)
      target.dispatchEvent(new Event("left"))

      deepEqual((await selected)?.type, "left")
      deepEqual(getEventListeners(target, "left").length, 0)
    },
  },
  {
    name: "once detaches its listener when its owner aborts",
    run: async () => {
      const owner = new AbortController()
      const target = new OnceTarget()
      const selected = once(owner.signal, target, "left")

      owner.abort()

      deepEqual(await selected, undefined)
      deepEqual(getEventListeners(target, "left").length, 0)
    },
  },
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
    name: "return detaches an event stream before its parent later aborts",
    run: async () => {
      const owner = new AbortController()
      const target = new ChangeTarget()
      const values = events(owner.signal, target, "change")
      const pending = values.next()
      target.dispatchEvent(new Event("change"))

      deepEqual((await pending).done, false)
      deepEqual(await values.return?.(undefined), {
        done: true,
        value: undefined,
      })
      const deliveries = target.deliveries

      owner.abort()
      target.dispatchEvent(new Event("change"))

      deepEqual(target.deliveries, deliveries)
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
    name: "request abort settles a pending logical fetch",
    run: async (context: TestContext) =>
      withFetch(context, async () => {
        const entered = Promise.withResolvers<void>()
        context.mock.method(
          globalThis,
          "fetch",
          async (_input: string | URL | Request, init?: RequestInit) => {
            const signal = init?.signal
            assert(signal instanceof AbortSignal)
            return await new Promise<Response>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              })
              entered.resolve()
            })
          },
        )
        const owner = new AbortController()
        const values = logical_stream(
          new Request("https://example.test/stream", { signal: owner.signal }),
        )
        const pending = values.next()
        await entered.promise

        owner.abort()

        const failure = await pending.then(
          () => undefined,
          (error: unknown) => error,
        )
        assert(failure instanceof DOMException)
        deepEqual(failure.name, "AbortError")
        await values.return(undefined)
      }),
  },
  {
    name: "request abort settles a pending logical response body read",
    run: async (context: TestContext) =>
      withFetch(context, async () => {
        const bodyReady = Promise.withResolvers<ReadableStream<Uint8Array>>()
        const entered = Promise.withResolvers<void>()
        const state = { aborts: 0, cancellations: 0, pulls: 0 }
        context.mock.method(
          globalThis,
          "fetch",
          async (_input: string | URL | Request, init?: RequestInit) => {
            const signal = init?.signal
            assert(signal instanceof AbortSignal)
            const body = new ReadableStream<Uint8Array>({
              cancel: () => {
                state.cancellations += 1
              },
              pull: () => {
                state.pulls += 1
                entered.resolve()
              },
              start: (controller) => {
                signal.addEventListener(
                  "abort",
                  () => {
                    state.aborts += 1
                    controller.error(signal.reason)
                  },
                  { once: true },
                )
              },
            })
            bodyReady.resolve(body)
            return new Response(body)
          },
        )
        const owner = new AbortController()
        const values = logical_stream(
          new Request("https://example.test/body", { signal: owner.signal }),
        )
        const pending = values.next()
        const body = await bodyReady.promise
        await entered.promise

        owner.abort()

        const settled = await Promise.race([
          pending.then(
            () => undefined,
            (error: unknown) => error,
          ),
          setImmediate("pending"),
        ])
        assert(settled instanceof DOMException)
        deepEqual(settled.name, "AbortError")
        deepEqual(
          { aborts: state.aborts, cancellations: state.cancellations },
          { aborts: 1, cancellations: 0 },
        )
        assert(state.pulls > 0)
        deepEqual(body.locked, false)
        deepEqual(await values.next(), { done: true, value: undefined })
      }),
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

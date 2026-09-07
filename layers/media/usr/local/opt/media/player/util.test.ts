import { deepEqual, ok as assert, rejects } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { getEventListeners } from "node:events"
import nodeTest, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"

import {
  closing,
  delay,
  event_batches,
  fetch_stream,
  inactivity,
  join,
  merge,
  once,
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

class OnceTarget extends EventTarget {
  onleft: ((event: Event) => unknown) | null = null
  onright: ((event: Event) => unknown) | null = null
  state = 0
}

const cases = [
  {
    name: "return drains queued event reads directly and through merge",
    run: async () => {
      for (const count of [0, 1, 8]) {
        for (const combined of [false, true]) {
          const owner = new AbortController()
          const target = new OnceTarget()
          const source = event_batches(
            owner.signal,
            target,
            ["left"],
            () => target.state,
          )
          const values = combined ? merge(source) : source
          try {
            const pending = Array.from({ length: count }, () => values.next())
            await setImmediate()
            const returned = values.return?.(undefined)
            const settled = Promise.all([...pending, returned])
            deepEqual(
              await Promise.race([
                settled.then((results) =>
                  results.every((result) => result?.done),
                ),
                setImmediate("pending"),
              ]),
              true,
            )
            deepEqual(getEventListeners(target, "left"), [])
          } finally {
            owner.abort()
            await values.return?.(undefined)
          }
        }
      }
    },
  },
  ...(["fulfilled", "rejected"] as const).map((outcome) => ({
    name: `closing assimilates a ${outcome} return thenable once and completes cleanup`,
    run: async () => {
      const pending = Promise.withResolvers<undefined>()
      const failure = new Error("return failed")
      let assimilations = 0
      let cleaned = false
      const input: PromiseLike<undefined> = {
        then: (fulfilled, rejected) => {
          assimilations += 1
          return pending.promise.then(fulfilled, rejected)
        },
      }
      const values = closing(
        new AbortController().signal,
        async function* (signal) {
          try {
            yield 1
          } finally {
            assert(signal.aborted)
            cleaned = true
          }
          return
        },
      )
      await values.next()
      const returned = values.return?.(input)
      assert(returned)
      const settled = returned.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      )
      try {
        await setImmediate()
        deepEqual(assimilations, 1)
        if (outcome === "fulfilled") {
          pending.resolve(undefined)
          deepEqual(await settled, { result: { done: true, value: undefined } })
        } else {
          pending.reject(failure)
          deepEqual(await settled, { error: failure })
        }
        assert(cleaned)
        deepEqual(assimilations, 1)
      } finally {
        pending.resolve(undefined)
        await settled
        await values.return?.(undefined)
      }
    },
  })),
  {
    name: "closing preserves native return-before-next call ordering",
    run: async () => {
      const open = async function* () {
        yield 1
        yield 2
        return
      }
      for (const values of [
        open(),
        closing(new AbortController().signal, open),
      ]) {
        try {
          deepEqual(await values.next(), { done: false, value: 1 })
          const closed = values.return?.(undefined)
          const later = values.next()
          deepEqual(await Promise.all([closed, later]), [
            { done: true, value: undefined },
            { done: true, value: undefined },
          ])
        } finally {
          await values.return?.(undefined)
        }
      }
    },
  },
  {
    name: "closing reserves return order while its value is still pending",
    run: async () => {
      const result = Promise.withResolvers<undefined>()
      const values = closing(new AbortController().signal, async function* () {
        yield 1
        yield 2
        return
      })
      try {
        deepEqual(await values.next(), { done: false, value: 1 })
        const closed = values.return?.(result.promise)
        const later = values.next()
        await setImmediate()
        result.resolve(undefined)
        deepEqual(await Promise.all([closed, later]), [
          { done: true, value: undefined },
          { done: true, value: undefined },
        ])
      } finally {
        result.resolve(undefined)
        await values.return?.(undefined)
      }
    },
  },
  {
    name: "merge does not discard values when the same iterator is supplied twice",
    run: async () => {
      const source = (async function* () {
        yield 1
        yield 2
        return
      })()
      const received: number[] = []
      for await (const [, value] of merge(source, source)) {
        received.push(value)
      }
      deepEqual(received, [1, 2])
    },
  },
  {
    name: "join completes empty and successful groups",
    run: async () => {
      deepEqual(await join([]), undefined)
      deepEqual(
        await join([Promise.resolve(1), Promise.resolve("done")]),
        undefined,
      )
    },
  },
  ...[new Error("single failure"), undefined].map((failure) => ({
    name: `join preserves a single ${failure === undefined ? "undefined rejection" : "error"} after all work settles`,
    run: async () => {
      const pending = Promise.withResolvers<void>()
      const outcomes: unknown[] = []
      const joined = join([Promise.reject(failure), pending.promise]).then(
        () => outcomes.push({ success: true }),
        (error: unknown) => outcomes.push({ error }),
      )
      await setImmediate()
      deepEqual(outcomes, [])
      pending.resolve()
      await joined
      deepEqual(outcomes, [{ error: failure }])
    },
  })),
  {
    name: "join aggregates failures in input order after every task settles",
    run: async () => {
      const first = Promise.withResolvers<void>()
      const left = new Error("left")
      const right = new Error("right")
      const outcomes: unknown[] = []
      const joined = join([first.promise, Promise.reject(right)]).then(
        () => outcomes.push({ success: true }),
        (error: unknown) => outcomes.push(error),
      )
      await setImmediate()
      deepEqual(outcomes.length, 0)
      first.reject(left)
      await joined
      const [error] = outcomes
      assert(error instanceof AggregateError)
      deepEqual(error.errors, [left, right])
    },
  },
  {
    name: "closing aborts before returning its source",
    run: async () => {
      const owner = new AbortController()
      const sequence: string[] = []
      const values = closing(owner.signal, async function* (signal) {
        const aborted = Promise.withResolvers<void>()
        signal.addEventListener(
          "abort",
          () => {
            sequence.push("abort")
            aborted.resolve()
          },
          { once: true },
        )
        try {
          yield 1
        } finally {
          sequence.push("return")
          await aborted.promise
        }
        return
      })

      deepEqual(await values.next(), { done: false, value: 1 })
      const closed = values.return?.(undefined)
      assert(closed)
      deepEqual(await closed, {
        done: true,
        value: undefined,
      })
      deepEqual(sequence, ["abort", "return"])
    },
  },
  {
    name: "closing runs source cleanup when the return value rejects",
    run: async () => {
      const owner = new AbortController()
      const failure = new Error("return value failed")
      const sequence: string[] = []
      const values = closing(owner.signal, async function* (signal) {
        signal.addEventListener("abort", () => sequence.push("abort"), {
          once: true,
        })
        try {
          yield 1
        } finally {
          sequence.push("cleanup")
        }
        return
      })

      deepEqual(await values.next(), { done: false, value: 1 })
      const closed = values.return?.(Promise.reject(failure))
      assert(closed)
      await rejects(closed, (error) => error === failure)
      const observed = [...sequence]
      await values.return?.(undefined)

      deepEqual(observed, ["abort", "cleanup"])
    },
  },
  {
    name: "closing interrupts a pending source read before returning",
    run: async () => {
      const owner = new AbortController()
      const values = closing(owner.signal, async function* (signal) {
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true })
        })
        return
      })
      const pending = values.next()
      const closed = values.return?.(undefined)
      assert(closed)

      deepEqual(
        await Promise.race([
          Promise.all([pending, closed]),
          setImmediate("pending"),
        ]),
        [
          { done: true, value: undefined },
          { done: true, value: undefined },
        ],
      )
    },
  },
  ...(["unstarted", "completed"] as const).map((state) => ({
    name: `closing preserves a rejected return value when the source is ${state}`,
    run: async () => {
      const owner = new AbortController()
      const failure = new Error("return value failed")
      const values = closing(owner.signal, async function* () {
        return
      })
      if (state === "completed") {
        deepEqual(await values.next(), { done: true, value: undefined })
      }

      const closed = values.return?.(Promise.reject(failure))
      assert(closed)
      await rejects(closed, (error) => error === failure)
      deepEqual(await values.next(), { done: true, value: undefined })
    },
  })),
  {
    name: "closing waits for cleanup and preserves both return and cleanup failures",
    run: async () => {
      const owner = new AbortController()
      const failure = new Error("return value failed")
      const cleanup_failure = new Error("cleanup failed")
      const release = Promise.withResolvers<void>()
      const entered = Promise.withResolvers<void>()
      const values = closing(owner.signal, async function* (signal) {
        try {
          yield 1
        } finally {
          assert(signal.aborted)
          entered.resolve()
          await release.promise
          throw cleanup_failure
        }
      })
      await values.next()
      const closed = values.return?.(Promise.reject(failure))
      assert(closed)
      const outcomes: unknown[] = []
      const settled = closed.then(
        () => outcomes.push("closed"),
        (error: unknown) => outcomes.push(error),
      )
      await entered.promise
      await setImmediate()
      deepEqual(outcomes.length, 0)
      release.resolve()
      await settled
      const [error] = outcomes
      assert(error instanceof AggregateError)
      deepEqual(error.errors, [failure, cleanup_failure])
    },
  },
  {
    name: "closing forwards a resolved return value to its source",
    run: async () => {
      const owner = new AbortController()
      const values = closing(
        owner.signal,
        async function* (signal): AsyncGenerator<number, number, void> {
          try {
            yield 1
          } finally {
            assert(signal.aborted)
          }
          return 2
        },
      )
      await values.next()
      deepEqual(await values.return?.(Promise.resolve(3)), {
        done: true,
        value: 3,
      })
    },
  },
  {
    name: "for-await returns before scoped abort disposal",
    run: async () => {
      const sequence: string[] = []
      const release = Promise.withResolvers<void>()
      let returned = false

      const abort = {
        [Symbol.dispose]: () => sequence.push("abort"),
      }
      const source = {
        [Symbol.asyncDispose]: async () => {
          sequence.push("asyncDispose")
          await source.return()
        },
        [Symbol.asyncIterator]: () => source,
        next: async () => ({ done: false, value: 1 }) as const,
        return: async () => {
          sequence.push("return")
          if (!returned) {
            returned = true
            await release.promise
          }
          return { done: true, value: undefined } as const
        },
      }

      const values = (async function* () {
        using a = abort
        using _ = a
        await using stream = source

        for await (const value of stream) {
          yield value
        }
      })()

      deepEqual(await values.next(), { done: false, value: 1 })
      const closed = values.return(undefined)
      await setImmediate()

      deepEqual(sequence, ["return"])

      release.resolve()
      deepEqual(await closed, { done: true, value: undefined })
      deepEqual(sequence, [
        "return",
        "asyncDispose",
        "return",
        "abort",
        "abort",
      ])
    },
  },
  {
    name: "delay resolves true when its timer wins",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const elapsed = delay(owner.signal, 100)

      context.mock.timers.tick(100)

      deepEqual(await elapsed, true)
    },
  },
  {
    name: "delay resolves false and clears its timer when abort wins",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const elapsed = delay(owner.signal, 100)

      owner.abort()

      deepEqual(await elapsed, false)
      context.mock.timers.tick(100)
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
    name: "inactivity expires only after a quiet interval",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const values = inactivity(owner.signal, 100, async function* (signal) {
        yield 1
        await new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => resolve(), { once: true })
        })
        return
      })

      deepEqual(await values.next(), { done: false, value: 1 })
      const pending = values.next()
      await setImmediate()
      context.mock.timers.tick(99)
      context.mock.timers.tick(1)

      await rejects(pending, /stopped producing data/)
    },
  },
  {
    name: "inactivity ignores downstream work after received data",
    run: async (context: TestContext) => {
      context.mock.timers.enable({ apis: ["setTimeout"] })
      const owner = new AbortController()
      const values = inactivity(owner.signal, 100, async function* () {
        yield 1
        return
      })

      deepEqual(await values.next(), { done: false, value: 1 })
      context.mock.timers.tick(100)

      deepEqual(await values.next(), { done: true, value: undefined })
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
        const values = fetch_stream(
          new Request("https://example.test/stream", { signal: owner.signal }),
        )
        const pending = values.next()
        await entered.promise
        const closed = values.return?.(undefined)
        assert(closed)

        owner.abort()

        const settled = Promise.all([pending, closed] as const)
        deepEqual(
          await Promise.race([settled.then(() => true), setImmediate(false)]),
          true,
        )
        const [read, result] = await settled
        deepEqual(read, { done: true, value: undefined })
        deepEqual(result, { done: true, value: undefined })
      }),
  },
  {
    name: "return releases the body reader even when cancellation rejects",
    run: async (context: TestContext) =>
      withFetch(context, async () => {
        const failure = new Error("cancellation failed")
        const state = { cancelled: 0 }
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(new Uint8Array([1])),
          cancel: () => {
            state.cancelled += 1
            throw failure
          },
        })
        context.mock.method(globalThis, "fetch", async () => new Response(body))
        const owner = new AbortController()
        const values = fetch_stream(
          new Request("https://example.test/stream", {
            signal: owner.signal,
          }),
        )
        await values.next()
        deepEqual(await values.return?.(), { done: true, value: undefined })
        deepEqual(state.cancelled, 1)
        deepEqual(body.locked, false)
      }),
  },
  {
    name: "return from a logical stream starts body cancellation after abort",
    run: async (context: TestContext) =>
      withFetch(context, async () => {
        const owner = new AbortController()
        const aborted = Promise.withResolvers<void>()
        const sequence: string[] = []
        context.mock.method(
          globalThis,
          "fetch",
          async (_input: string | URL | Request, init?: RequestInit) => {
            const requestSignal = init?.signal
            assert(requestSignal)
            requestSignal.addEventListener(
              "abort",
              () => {
                sequence.push("abort")
                aborted.resolve()
              },
              { once: true },
            )
            return new Response(
              new ReadableStream<Uint8Array>({
                cancel: async () => {
                  sequence.push("cancel")
                  await aborted.promise
                  sequence.push("cancelled")
                },
                start: (controller) => {
                  controller.enqueue(new Uint8Array([1]))
                },
              }),
            )
          },
        )
        const values = fetch_stream(
          new Request("https://example.test/stream", {
            signal: owner.signal,
          }),
        )

        deepEqual(await values.next(), {
          done: false,
          value: new Uint8Array([1]),
        })
        const closed = values.return?.(undefined)
        assert(closed)
        const observed = {
          result: await Promise.race([
            closed.then(() => "closed"),
            setImmediate("pending"),
          ]),
          sequence: [...sequence],
        }

        owner.abort()
        await closed

        deepEqual(observed, {
          result: "closed",
          sequence: ["abort", "cancel", "cancelled"],
        })
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
        const values = fetch_stream(
          new Request("https://example.test/body", { signal: owner.signal }),
        )
        const pending = values.next()
        const body = await bodyReady.promise
        await entered.promise
        const closed = values.return?.(undefined)
        assert(closed)

        owner.abort()

        const settled = Promise.all([pending, closed] as const)
        deepEqual(
          await Promise.race([settled.then(() => true), setImmediate(false)]),
          true,
        )
        const [read, result] = await settled
        deepEqual(read, { done: true, value: undefined })
        deepEqual(result, { done: true, value: undefined })
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
    name: "inactivity settles despite an uncooperative body cancellation",
    run: async (context: TestContext) =>
      withFetch(context, async () => {
        context.mock.timers.enable({ apis: ["setTimeout"] })
        context.mock.method(
          globalThis,
          "fetch",
          async () =>
            new Response(
              new ReadableStream<Uint8Array>({
                cancel: () => new Promise<void>(() => {}),
                pull: () => undefined,
              }),
            ),
        )
        const owner = new AbortController()
        const values = inactivity(owner.signal, 100, (signal) =>
          fetch_stream(new Request("https://example.test/body", { signal })),
        )
        const pending = values.next()

        context.mock.timers.tick(100)

        deepEqual(
          await Promise.race([
            pending.then(
              () => "completed",
              () => "failed",
            ),
            setImmediate("pending"),
          ]),
          "failed",
        )
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
    name: "return interrupts a pending merged read",
    run: async () => {
      const entered = Promise.withResolvers<void>()
      const read = Promise.withResolvers<IteratorResult<number>>()
      let returns = 0
      const source: AsyncIterator<number> = {
        next: async () => {
          entered.resolve()
          return await read.promise
        },
        return: async () => {
          returns += 1
          read.resolve({ done: true, value: undefined })
          return { done: true, value: undefined }
        },
      }
      const values = merge(source)
      const pending = values.next()
      await entered.promise
      const closed = values.return?.(undefined)
      assert(closed)

      deepEqual(
        await Promise.race([
          Promise.all([pending, closed]),
          setImmediate("pending"),
        ]),
        [
          { done: true, value: undefined },
          { done: true, value: undefined },
        ],
      )
      deepEqual(returns, 1)
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
      deepEqual(failure.error, closeFailure)
      deepEqual(failure.suppressed, sourceFailure)
    },
  },
]

const shuffled = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(shuffled.map(({ name, run }) => nodeTest(name, options, run)))

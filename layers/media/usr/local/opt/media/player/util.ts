export const defer = <T>(f: () => T) => ({
  [Symbol.dispose]: f,
  [Symbol.asyncDispose]: f,
})

export const abortion = (...parents: AbortSignal[]) => {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, ...parents])

  return { signal, [Symbol.dispose]: () => controller.abort() }
}

export const delay = (signal: AbortSignal, ms: number): Promise<boolean> => {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const cancelled = () => {
    clearTimeout(timeout)
    resolve(false)
  }
  const timeout = setTimeout(() => {
    signal.removeEventListener("abort", cancelled)
    resolve(true)
  }, ms)

  signal.addEventListener("abort", cancelled, { once: true })
  return promise
}

type EventMap<T> = {
  [K in keyof T as K extends `on${infer E}` ? E : never]: NonNullable<
    T[K]
  > extends (event: infer R) => unknown
    ? R
    : never
}

type EventName<T> = keyof EventMap<T> & string
export type EventOf<T, E extends EventName<T>> = Extract<EventMap<T>[E], Event>

export const once = <
  const T extends EventTarget,
  const E extends EventName<T>,
  const R extends EventOf<T, E> = EventOf<T, E>,
>(
  signal: AbortSignal,
  target: T,
  event: E,
): Promise<R | undefined> => {
  if (signal.aborted) {
    return Promise.resolve(undefined)
  }

  const { promise, resolve } = Promise.withResolvers<R | undefined>()

  let closed = false
  const finish = (value?: R): void => {
    if (closed) {
      return
    }
    closed = true
    signal.removeEventListener("abort", cancelled)
    target.removeEventListener(event, received)
    resolve(value)
  }
  const cancelled = (): void => finish()
  const received = (value: Event): void => finish(value as R)

  signal.addEventListener("abort", cancelled, { once: true })
  target.addEventListener(event, received)
  if (signal.aborted) {
    cancelled()
  }
  return promise
}

export const readableIterator = async function* <const T>(
  stream: ReadableStream<T>,
): AsyncIteratorObject<T> {
  const reader = stream.getReader()
  let eof = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        eof = true
        return
      }
      yield value
    }
  } finally {
    try {
      if (!eof) {
        await reader.cancel()
      }
    } finally {
      reader.releaseLock()
    }
  }
}

export const events = async function* <
  const T extends EventTarget,
  const E extends EventName<T>,
  const R extends EventMap<T>[E],
>(signal: AbortSignal, target: T, event: E): AsyncIteratorObject<R> {
  using a = abortion(signal)
  let closed = false

  const stream = new ReadableStream<R>({
    start: (controller) => {
      if (a.signal.aborted) {
        controller.close()
        return
      }

      a.signal.addEventListener(
        "abort",
        () => {
          if (closed) {
            return
          }
          closed = true
          controller.close()
        },
        { once: true },
      )
      target.addEventListener(
        event,
        (received) => controller.enqueue(received as R),
        { signal: a.signal },
      )
    },
    cancel: () => {
      closed = true
    },
  })

  yield* readableIterator(stream)
  return
}

const next = async <const T>(
  aiter: AsyncIterator<T>,
): Promise<readonly [AsyncIterator<T>, IteratorResult<T>]> => [
  aiter,
  await aiter.next(),
]

const close = async <T>(aiters: Iterable<AsyncIterator<T>>): Promise<void> => {
  const settled = await Promise.allSettled(
    [...aiters].map(async (aiter) => aiter.return?.()),
  )
  const errors = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  )
  if (errors.length > 0) {
    throw new AggregateError(errors)
  }
}

type Selection<T extends readonly AsyncIterator<unknown>[]> = {
  [K in keyof T]: T[K] extends AsyncIterator<infer U> ? [T[K], U] : never
}[number]

export const merge = async function* <
  const T extends readonly AsyncIterator<unknown>[],
>(...aiters: T): AsyncIteratorObject<Selection<T>> {
  const pending = new Map(aiters.map((aiter) => [aiter, next(aiter)] as const))
  await using _ = defer(() => close(pending.keys()))

  while (pending.size) {
    const [aiter, result] = await Promise.race(pending.values())
    if (result.done) {
      pending.delete(aiter)
      continue
    }

    yield [aiter, result.value] as Selection<T>
    pending.set(aiter, next(aiter))
  }
  return
}

const stream = async function* (
  request: Request,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> {
  using a = abortion(request.signal)
  const response = await fetch(request, { signal: a.signal })

  if (!response.ok) {
    throw new Error([response.status, response.statusText].join(" "), {
      cause: response,
    })
  }

  if (response.body) {
    yield* readableIterator(response.body)
  }
  return
}

export const logical_stream = async function* (
  request: Request,
): AsyncGenerator<Uint8Array<ArrayBuffer>, undefined, Request | undefined> {
  l1: for (;;) {
    for await (const bytes of stream(request)) {
      const next = yield bytes
      if (next !== undefined) {
        request = next
        continue l1
      }
    }
    return
  }
}

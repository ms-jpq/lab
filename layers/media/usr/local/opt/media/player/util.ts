export const defer = <T>(f: () => T) => ({
  [Symbol.dispose]: f,
  [Symbol.asyncDispose]: f,
})

export const abortion = (...parents: AbortSignal[]) => {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, ...parents])

  return { signal, [Symbol.dispose]: () => controller.abort() }
}

type EventMap<T> = {
  [K in keyof T as K extends `on${infer E}` ? E : never]: NonNullable<
    T[K]
  > extends (event: infer R) => unknown
    ? R
    : never
}

type EventName<T> = keyof EventMap<T> & string

export const once = <
  T extends EventTarget,
  E extends EventName<T>,
  R extends EventMap<T>[E],
>(
  signal: AbortSignal,
  target: T,
  event: E,
): Promise<R | undefined> => {
  const { promise, resolve } = Promise.withResolvers<R | undefined>()

  const cancelled = () => resolve(undefined)
  target.addEventListener(
    event,
    (received) => {
      signal.removeEventListener("abort", cancelled)
      resolve(received as R)
    },
    { signal, once: true },
  )
  signal.addEventListener("abort", cancelled, { once: true })
  if (signal.aborted) {
    cancelled()
  }
  return promise
}

export const readableIterator = async function* <T>(
  stream: ReadableStream<T>,
): AsyncIteratorObject<T> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      yield value
    }
  } finally {
    try {
      await reader.cancel()
    } finally {
      reader.releaseLock()
    }
  }
}

export const events = async function* <
  T extends EventTarget,
  E extends EventName<T>,
  R extends EventMap<T>[E],
>(signal: AbortSignal, target: T, event: E): AsyncIteratorObject<R> {
  using a = abortion(signal)

  const stream = new ReadableStream<R>({
    start: (controller) => {
      if (a.signal.aborted) {
        controller.close()
        return
      }

      signal.addEventListener("abort", () => controller.close(), {
        once: true,
        signal: a.signal,
      })
      target.addEventListener(
        event,
        (received) => controller.enqueue(received as R),
        { signal: a.signal },
      )
    },
  })

  yield* readableIterator(stream)
  return
}

const select = async <T>(
  source: AsyncIterator<T>,
): Promise<readonly [AsyncIterator<T>, IteratorResult<T>]> => [
  source,
  await source.next(),
]

const close = async <T>(sources: Iterable<AsyncIterator<T>>): Promise<void> => {
  const settled = await Promise.allSettled(
    [...sources].map(async (source) => source.return?.()),
  )
  const errors = settled.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  )
  if (errors.length > 0) {
    throw new AggregateError(errors)
  }
}

export const merge = async function* <T>(
  ...sources: AsyncIterator<T>[]
): AsyncIteratorObject<T> {
  const pending = new Map(
    sources.map((source) => [source, select(source)] as const),
  )
  await using _ = defer(() => close(pending.keys()))

  while (pending.size) {
    const [source, result] = await Promise.race(pending.values())
    if (result.done) {
      pending.delete(source)
      continue
    }

    yield result.value
    pending.set(source, select(source))
  }
  return
}

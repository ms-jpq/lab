type EventMap<T> = {
  [K in keyof T as K extends `on${infer E}` ? E : never]: NonNullable<
    T[K]
  > extends (event: infer R) => unknown
    ? R
    : never
}

type EventName<T> = keyof EventMap<T> & string
export type EventOf<T, E extends EventName<T>> = Extract<EventMap<T>[E], Event>

type Entry<T> = T extends AsyncIterator<infer U> ? [T, U] : never
type Selection<T extends readonly AsyncIterator<unknown>[]> = Entry<T[number]>
type Observation<S, E> = Readonly<{ current: S; type: E }>

export const never = (value: never): never => {
  throw new Error(value)
}

export const defer = <T>(f: () => T) => ({
  [Symbol.dispose]: f,
  [Symbol.asyncDispose]: f,
})

export const abortion = (...parents: AbortSignal[]) => {
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, ...parents])

  return { signal, [Symbol.dispose]: () => controller.abort() }
}

export const closing = <const T, const R = undefined, const N = void>(
  signal: AbortSignal,
  open: (signal: AbortSignal) => AsyncIteratorObject<T, R, N>,
): AsyncIteratorObject<T, R, N> => {
  const a = abortion(signal)

  const aiter = (async function* () {
    using _ = a
    return yield* open(a.signal)
  })()
  const bound = aiter.return?.bind(aiter)

  const close = async (value: R | PromiseLike<R>) => {
    a[Symbol.dispose]()
    return bound?.(await value)
  }

  Object.defineProperties(aiter, {
    [Symbol.asyncDispose]: { value: close },
    return: { value: close },
  })
  return aiter
}

export const inactivity = <const T>(
  signal: AbortSignal,
  timeout: number,
  open: (_: AbortSignal) => AsyncIteratorObject<T>,
): AsyncIteratorObject<T> =>
  closing(signal, async function* (signal) {
    using a = abortion(signal)
    const deadline = () => setTimeout(() => a[Symbol.dispose](), timeout)
    let timer = deadline()
    using _ = defer(() => clearTimeout(timer))

    for await (const value of open(a.signal)) {
      clearTimeout(timer)
      timer = deadline()
      yield value
    }
    if (a.signal.aborted && !signal.aborted) {
      throw new Error("The request stopped producing data")
    }
    return
  })

export const delay = async (
  signal: AbortSignal,
  ms: number,
): Promise<boolean> => {
  if (signal.aborted) {
    return false
  }
  using a = abortion(signal)
  using _ = defer(() => clearTimeout(timeout))
  const fut = Promise.withResolvers<boolean>()
  const timeout = setTimeout(() => fut.resolve(true), ms)
  a.signal.addEventListener("abort", () => fut.resolve(false), { once: true })

  return await fut.promise
}

export const once = async <
  const T extends EventTarget,
  const E extends EventName<T>,
>(
  signal: AbortSignal,
  target: T,
  event: E,
): Promise<EventOf<T, E> | undefined> => {
  if (signal.aborted) {
    return undefined
  }

  const fut = Promise.withResolvers<EventOf<T, E> | undefined>()
  const cancelled = () => fut.resolve(undefined)
  const received = (value: Event) => {
    signal.removeEventListener("abort", cancelled)
    fut.resolve(value as EventOf<T, E>)
  }

  signal.addEventListener("abort", cancelled, { once: true })
  target.addEventListener(event, received, { once: true, signal })
  return fut.promise
}

const readableIterator = async function* <const T>(
  stream: ReadableStream<T>,
  signal: AbortSignal,
): AsyncIteratorObject<T> {
  using a = abortion(signal)
  const reader = stream.getReader()
  const cancelled = Promise.withResolvers<undefined>()

  a.signal.addEventListener("abort", () => cancelled.resolve(undefined), {
    once: true,
  })

  let eof = false
  try {
    while (!a.signal.aborted) {
      const result = await Promise.race([reader.read(), cancelled.promise])
      if (result === undefined) {
        return
      }
      const { done, value } = result
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

  return
}

export const event_batches = <
  const T extends EventTarget,
  const E extends EventName<T>,
  const S,
>(
  signal: AbortSignal,
  target: T,
  names: readonly E[],
  capture: () => S,
): AsyncIteratorObject<readonly Observation<S, E>[]> =>
  closing(signal, async function* (signal) {
    const pending: Observation<S, E>[] = []
    let fut = Promise.withResolvers()

    signal.addEventListener("abort", () => fut.resolve(undefined), {
      once: true,
    })

    for (const type of names) {
      target.addEventListener(
        type,
        () => {
          pending.push({ current: capture(), type })
          fut.resolve(undefined)
        },
        { signal },
      )
    }

    while (!signal.aborted) {
      if (pending.length === 0) {
        await fut.promise
      }
      if (signal.aborted) {
        return
      }

      const batch = pending.splice(0)
      fut = Promise.withResolvers()
      yield batch
    }
    return
  })

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
  const errors = settled.flatMap((result) => {
    if (result.status === "rejected") {
      return [result.reason]
    }
    return []
  })
  if (errors.length > 0) {
    throw new AggregateError(errors)
  }
}

export const merge = <const T extends readonly AsyncIterator<unknown>[]>(
  ...aiters: T
): AsyncIteratorObject<Selection<T>> =>
  closing(new AbortController().signal, async function* (signal) {
    const pending = new Map(
      aiters.map((aiter) => [aiter, next(aiter)] as const),
    )
    const cancelled = Promise.withResolvers<undefined>()
    signal.addEventListener("abort", () => cancelled.resolve(undefined), {
      once: true,
    })
    await using _ = defer(() => close(pending.keys()))

    while (pending.size) {
      const selected = await Promise.race([
        ...pending.values(),
        cancelled.promise,
      ])
      if (selected === undefined) {
        return
      }
      const [aiter, result] = selected
      if (result.done) {
        pending.delete(aiter)
        continue
      }

      yield [aiter, result.value] as Selection<T>
      pending.set(aiter, next(aiter))
    }
    return
  })

export const fetch_stream = (
  request: Request,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> =>
  closing(request.signal, async function* (signal) {
    try {
      const response = await fetch(request, { signal })

      if (!response.ok) {
        throw new Error([response.status, response.statusText].join(" "), {
          cause: response,
        })
      }

      if (response.body) {
        yield* readableIterator(response.body, signal)
      }
    } catch (error) {
      if (!signal.aborted) {
        throw error
      }
    }
    return
  })

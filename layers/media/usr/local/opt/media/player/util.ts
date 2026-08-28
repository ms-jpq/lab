type EventMap<T> = {
  [K in keyof T as K extends `on${infer E}` ? E : never]: NonNullable<
    T[K]
  > extends (event: infer R) => unknown
    ? R
    : never
}

type EventName<T> = keyof EventMap<T> & string

export const once = <T extends EventTarget, E extends EventName<T>>(
  signal: AbortSignal,
  target: T,
  event: E,
): Promise<EventMap<T>[E]> => {
  const { promise, reject, resolve } = Promise.withResolvers<EventMap<T>[E]>()
  const cancelled = () => reject(signal.reason)
  target.addEventListener(
    event,
    (received) => {
      signal.removeEventListener("abort", cancelled)
      resolve(received as EventMap<T>[E])
    },
    { signal, once: true },
  )
  signal.addEventListener("abort", cancelled, { once: true })
  if (signal.aborted) {
    cancelled()
  }
  return promise
}

export const event_race = <
  T extends EventTarget,
  const E extends EventName<T>[],
>(
  signal: AbortSignal,
  target: T,
  ...events: E
): Promise<EventMap<T>[E[number]]> =>
  Promise.race(events.map((event) => once(signal, target, event)))

export const defer = <T>(f: () => T) => ({
  [Symbol.dispose]: f,
  [Symbol.asyncDispose]: f,
})

export const abortion = (parent?: AbortSignal) => {
  const controller = new AbortController()
  const signal = AbortSignal.any([
    ...(parent ? [parent] : []),
    controller.signal,
  ])

  return { signal, [Symbol.dispose]: () => controller.abort() }
}

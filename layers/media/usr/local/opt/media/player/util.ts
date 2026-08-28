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
export const abortion = (parent?: AbortSignal) => {
  const controller = new AbortController()
  const signal = AbortSignal.any([
    ...(parent ? [parent] : []),
    controller.signal,
  ])

  return {
    controller,
    signal,
    [Symbol.dispose]: async () => controller.abort(),
  }
}
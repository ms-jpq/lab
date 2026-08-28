import { abortion, readableIterator } from "./util.js"

const stream = async function* (
  request: Request,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> {
  using a = abortion(request.signal)
  const response = await fetch({ ...request, signal: a.signal })

  if (!response.ok) {
    throw new Error([response.status, response.statusText].join(" "))
  }

  if (response.body) {
    yield* readableIterator(response.body)
  }
  return
}

export const water_stream = async function* (
  request: Request,
  lo: () => true,
  hi: () => true,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> {
    // humm what should the logic be to support this? like we do need to stream at a different location right?
  for (;;) {
    for await (const bytes of stream(request)) {
      yield bytes
      if (hi()) {
        break
      }
    }
  }
}

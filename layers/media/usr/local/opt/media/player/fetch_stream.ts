import { abortion, readableIterator } from "./util.js"

const stream = async function* (
  request: Request,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> {
  using a = abortion(request.signal)
  const response = await fetch(new Request(request, { signal: a.signal }))

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

export const water_stream = async function* (
  request: Request,
  lo: () => true,
  hi: () => true,
): Generator<Uint8Array<ArrayBuffer>, undefined, Request> {
  for (;;) {
    for await (const bytes of stream(request)) {
      yield bytes
      if (hi()) {
        break
      }
    }
  }
}

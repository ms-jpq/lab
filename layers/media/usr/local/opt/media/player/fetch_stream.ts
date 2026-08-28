import { abortion, readableIterator } from "./util.js"

const stream = async function* (
  request: Request,
): AsyncIteratorObject<Uint8Array<ArrayBuffer>> {
  using a = abortion(request.signal)
  const response = await fetch({ ...request, signal: a.signal })

  if (response.body) {
    yield* readableIterator(response.body)
  }
  return
}

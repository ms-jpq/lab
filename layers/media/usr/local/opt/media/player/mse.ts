import { events } from "./util.ts"

export type MseOperation = "end" | number | Uint8Array
export type Mse = AsyncGenerator<void, void, MseOperation>

type MseContext = {
  currentTime: () => number
  signal: AbortSignal
  source: MediaSource
}

const BEHIND = 30

export const mse = async function* (
  buffer: SourceBuffer,
  { currentTime, signal, source }: MseContext,
): Mse {
  const update = async (mutate: () => void) => {
    const operation = new AbortController()
    try {
      const settled = events(operation.signal, buffer, "updateend", "error")
      mutate()
      const event = await settled
      if (event?.type === "error") {
        throw event
      }
    } finally {
      operation.abort()
    }
  }

  let started = false
  for (let operation = yield undefined; ; operation = yield undefined) {
    if (signal.aborted) {
      return
    }
    if (operation === "end") {
      source.endOfStream()
      continue
    }
    if (typeof operation === "number") {
      if (started) {
        if (source.readyState === "ended") {
          const ranges = buffer.buffered
          const end = ranges.length ? ranges.end(ranges.length - 1) : 0
          await update(() => buffer.remove(end, end + 0.001))
        }
        buffer.abort()
      }
      buffer.timestampOffset = operation
      started = true
      continue
    }

    const expired = currentTime() - BEHIND
    const ranges = buffer.buffered
    if (expired > 0 && ranges.length && ranges.start(0) < expired) {
      await update(() => buffer.remove(0, expired))
    }
    await update(() =>
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>),
    )
  }
}

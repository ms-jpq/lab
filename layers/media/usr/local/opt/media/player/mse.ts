import { abortion, defer, events, merge, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array
export type Mse = AsyncGenerator<void, void, MseOperation>

const BEHIND = 30
const EPSILON = 0.001

const MSE = (): MediaSource => {
  return new (
    (
      globalThis as typeof globalThis & {
        ManagedMediaSource?: typeof MediaSource
      }
    ).ManagedMediaSource ?? MediaSource
  )()
}

const revoke = (url: string | undefined): void => {
  if (url !== undefined) {
    URL.revokeObjectURL(url)
  }
}

const op_lock = async function* (
  buffer: SourceBuffer,
  ...signals: AbortSignal[]
): AsyncIteratorObject<undefined> {
  using a = abortion(...signals)
  const changed = Promise.race([
    once(a.signal, buffer, "updateend"),
    once(a.signal, buffer, "error"),
  ])

  yield
  const event = await changed
  if (event?.type === "error") {
    throw event
  }
  return
}

export const media_source = async function* ({
  evict_before,
  mime_type,
  signal,
  source,
}: {
  evict_before: () => number
  mime_type: string
  signal: AbortSignal
  source: MediaSource
}): Mse {
  const buffer = source.addSourceBuffer(mime_type)

  let started = false
  for (let operation = yield undefined; ; operation = yield undefined) {
    if (signal.aborted) {
      return
    }
    using a = abortion(signal)

    if (operation === undefined) {
      source.endOfStream()
      continue
    }

    if (typeof operation === "number") {
      // i dont understand why we need started, is this just so we know the buffer has been drained?
      if (started) {
        using _ = defer(() => buffer.abort())

        if (source.readyState === "ended") {
          const ranges = buffer.buffered
          const end = ranges.length ? ranges.end(ranges.length - 1) : 0

          for await (const _ of op_lock(buffer)) {
            if (a.signal.aborted) {
              return
            }
            buffer.remove(end, end + EPSILON)
          }
          if (a.signal.aborted) {
            return
          }
        }
      }
      if (a.signal.aborted) {
        return
      }
      buffer.timestampOffset = operation
      started = true
      continue
    }

    {
      const cutoff = evict_before()
      if (
        cutoff > 0 &&
        buffer.buffered.length &&
        buffer.buffered.start(0) < cutoff
      ) {
        for await (const _ of op_lock(buffer)) {
          if (a.signal.aborted) {
            return
          }
          buffer.remove(0, cutoff)
        }
      }
      if (a.signal.aborted) {
        return
      }
    }
    for await (const _ of op_lock(buffer, a.signal)) {
      if (a.signal.aborted) {
        return
      }
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>)
    }
    if (a.signal.aborted) {
      if (buffer.updating) {
        buffer.abort()
      }
      return
    }
  }
}

export const media_sources = (media: HTMLMediaElement) => {
  const state: { url: string | undefined } = { url: undefined }

  return {
    close: (): void => {
      try {
        media.removeAttribute("src")
        media.load()
      } finally {
        revoke(state.url)
      }
    },
    open: async (
      signal: AbortSignal,
      seek: () => void,
    ): Promise<Mse | undefined> => {
      const source = MSE()
      const previous = state.url
      const next = URL.createObjectURL(source)
      using opening = abortion(signal)
      const opened = merge(
        events(opening.signal, source, "sourceopen"),
        events(opening.signal, source, "sourceclose"),
      )
      const selected = opened.next()
      const stop = async (): Promise<void> => {
        opening[Symbol.dispose]()
        await opened.return?.()
      }

      try {
        media.src = next
      } catch (error) {
        await stop()
        revoke(next)
        throw error
      }

      state.url = next
      try {
        seek()
        const result = await selected
        const event = result.done ? undefined : result.value[1]
        if (!event || signal.aborted) {
          return undefined
        }
        if (event.type !== "sourceopen") {
          throw event
        }

        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        const buffer = media_source({
          evict_before: () => media.currentTime - BEHIND,
          mime_type: media.dataset["mseType"] as string,
          signal,
          source,
        })
        await buffer.next()
        return buffer
      } finally {
        await stop()
        revoke(previous)
      }
    },
  }
}

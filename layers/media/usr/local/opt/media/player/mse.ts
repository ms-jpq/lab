import { abortion, events, merge } from "./util.ts"

export type MseOperation = "end" | number | Uint8Array
export type Mse = AsyncGenerator<void, void, MseOperation>

const BEHIND = 30

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

const op_lock = (
  buffer: SourceBuffer,
  signal: AbortSignal,
): AsyncDisposable => {
  const a = abortion(signal)
  const settled = merge(
    events(a.signal, buffer, "updateend"),
    events(a.signal, buffer, "error"),
  )
  const changed = settled.next()

  return {
    [Symbol.asyncDispose]: async () => {
      try {
        const { done, value } = await changed
        if (done) {
          return
        }
        const [_, event] = value
        if (event.type === "error") {
          throw event
        }
      } finally {
        a[Symbol.dispose]()
        await settled.return?.()
      }
    },
  }
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
    using a = abortion(signal)
    if (a.signal.aborted) {
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

          await using _ = op_lock(buffer, a.signal)
          buffer.remove(end, end + 0.001)
        }
        buffer.abort()
      }
      buffer.timestampOffset = operation
      started = true
      continue
    }

    const cutoff = evict_before()
    const ranges = buffer.buffered

    if (cutoff > 0 && ranges.length && ranges.start(0) < cutoff) {
      await using _ = op_lock(buffer, a.signal)
      buffer.remove(0, cutoff)
    }
    {
      await using _ = op_lock(buffer, a.signal)
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>)
    }
    if (a.signal.aborted && buffer.updating) {
      buffer.abort()
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

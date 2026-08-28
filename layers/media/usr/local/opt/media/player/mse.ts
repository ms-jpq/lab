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

  const update = async (mutate: () => void) => {
    using operation = abortion()
    const settled = merge<Event>(
      events(operation.signal, buffer, "updateend"),
      events(operation.signal, buffer, "error"),
    )
    const changed = settled.next()
    try {
      mutate()
      const result = await changed
      const event = result.done ? undefined : result.value
      if (event?.type === "error") {
        throw event
      }
    } finally {
      operation[Symbol.dispose]()
      await settled.return?.()
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

    const cutoff = evict_before()
    const ranges = buffer.buffered
    if (cutoff > 0 && ranges.length && ranges.start(0) < cutoff) {
      await update(() => buffer.remove(0, cutoff))
    }
    await update(() =>
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>),
    )
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
      const opened = merge<Event>(
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
        const event = result.done ? undefined : result.value
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

import { abortion, events, merge } from "./util.ts"

export type MseOperation = "end" | number | Uint8Array
export type Mse = AsyncGenerator<void, void, MseOperation>

type MseContext = {
  currentTime: () => number
  signal: AbortSignal
  source: MediaSource
}

const BEHIND = 30

const media_source = (): MediaSource => {
  const constructor = (
    globalThis as typeof globalThis & {
      ManagedMediaSource?: typeof MediaSource
    }
  ).ManagedMediaSource
  return new (constructor ?? MediaSource)()
}

const revoke = (url: string | undefined): void => {
  if (url !== undefined) {
    URL.revokeObjectURL(url)
  }
}

export const mse = async function* (
  buffer: SourceBuffer,
  { currentTime, signal, source }: MseContext,
): Mse {
  const update = async (mutate: () => void) => {
    using operation = abortion()
    const settled = merge<Event>(
      events(operation.signal, buffer, "updateend"),
      events(operation.signal, buffer, "error"),
    )
    const changed = settled.next()
    try {
      mutate()
      const { value: event } = await changed
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
      const source = media_source()
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
        const { value: event } = await selected
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
        const buffer = mse(
          source.addSourceBuffer(media.dataset["mseType"] as string),
          {
            currentTime: () => media.currentTime,
            signal,
            source,
          },
        )
        await buffer.next()
        return buffer
      } finally {
        await stop()
        revoke(previous)
      }
    },
  }
}

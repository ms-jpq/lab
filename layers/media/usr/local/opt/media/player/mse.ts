import { abortion, closing, defer, never, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array<ArrayBuffer>
export type Mse = AsyncGenerator<void, void, MseOperation>

const EPSILON = 0.001

export const closed = (source: MediaSource): boolean =>
  source.readyState === "closed"

const op_lock = async function* (
  buffer: SourceBuffer,
  media: HTMLMediaElement,
  source: MediaSource,
  signal: AbortSignal,
  timeout: number,
): AsyncIteratorObject<undefined> {
  if (signal.aborted) {
    return
  }

  const deadline = AbortSignal.timeout(timeout)
  using a = abortion(AbortSignal.any([signal, deadline]))
  const changed = Promise.race([
    once(a.signal, buffer, "updateend"),
    once(a.signal, buffer, "error"),
    once(a.signal, media, "seeking"),
    once(a.signal, source, "sourceclose"),
  ])

  yield
  const event = await changed
  if (event === undefined) {
    if (buffer.updating) {
      buffer.abort()
    }
    if (deadline.aborted && !signal.aborted) {
      throw new Error("SourceBuffer operation timed out")
    }
    return
  }
  switch (event?.type) {
    case "error":
      throw event
    case "seeking":
    case "sourceclose": {
      if (buffer.updating) {
        buffer.abort()
      }
    }
  }
  return
}

export const media_source = async function* ({
  media,
  mime_type,
  source,
  evict_before,
  signal,
  timeout,
}: {
  media: HTMLMediaElement
  mime_type: string
  source: MediaSource
  evict_before: () => number
  signal: AbortSignal
  timeout: number
}): Mse {
  using a = abortion(signal)
  if (a.signal.aborted) {
    return
  }

  const buffer = source.addSourceBuffer(mime_type)

  const position = (yield undefined) as number
  if (a.signal.aborted) {
    return
  }
  buffer.timestampOffset = position

  for (let operation = yield undefined; ; operation = yield undefined) {
    if (a.signal.aborted) {
      return
    }

    if (operation === undefined) {
      source.endOfStream()
      continue
    }

    if (typeof operation === "number") {
      if (source.readyState === "ended") {
        const ranges = buffer.buffered
        const end = ranges.length ? ranges.end(ranges.length - 1) : 0

        for await (const _ of op_lock(
          buffer,
          media,
          source,
          a.signal,
          timeout,
        )) {
          buffer.remove(end, end + EPSILON)
        }
        if (closed(source)) {
          return
        }
      }
      {
        buffer.abort()
        buffer.timestampOffset = operation
      }
      continue
    }

    if (operation instanceof Uint8Array) {
      const cutoff = evict_before()
      if (
        cutoff > 0 &&
        buffer.buffered.length &&
        buffer.buffered.start(0) < cutoff
      ) {
        for await (const _ of op_lock(
          buffer,
          media,
          source,
          a.signal,
          timeout,
        )) {
          buffer.remove(0, cutoff)
        }
        if (closed(source)) {
          return
        }
      }
      for await (const _ of op_lock(buffer, media, source, a.signal, timeout)) {
        buffer.appendBuffer(operation)
      }
      if (closed(source)) {
        return
      }
      continue
    }

    never(operation)
  }
}

const MSE = (): MediaSource =>
  new (
    (
      globalThis as typeof globalThis & {
        ManagedMediaSource?: typeof MediaSource
      }
    ).ManagedMediaSource ?? MediaSource
  )()

export const bond = (
  media: HTMLMediaElement,
  signal: AbortSignal,
  timeout: number,
): AsyncIteratorObject<MediaSource> =>
  closing(signal, async function* (signal) {
    while (!signal.aborted) {
      const source = MSE()
      const url = URL.createObjectURL(source)
      const prev = media.src

      let committed = false
      try {
        const deadline = AbortSignal.timeout(timeout)
        const event = await (async () => {
          using a = abortion(AbortSignal.any([signal, deadline]))
          const opened = Promise.race([
            once(a.signal, source, "sourceopen"),
            once(a.signal, source, "sourceclose"),
          ])
          media.src = url
          return await opened
        })()

        if (event === undefined && deadline.aborted && !signal.aborted) {
          throw new Error("MediaSource opening timed out")
        }
        if (event?.type === "sourceclose") {
          throw event
        }
        if (event === undefined) {
          return
        }
        committed = true
      } finally {
        if (!committed) {
          try {
            if (prev) {
              media.src = prev
            } else {
              media.removeAttribute("src")
            }
          } finally {
            URL.revokeObjectURL(url)
          }
        }
      }

      if (prev) {
        URL.revokeObjectURL(prev)
      }
      yield source
    }

    return
  })

export const media_sources = ({
  media,
  mime_type,
  evict_behind,
  signal,
  timeout,
}: {
  media: HTMLMediaElement
  mime_type: string
  evict_behind: number
  signal: AbortSignal
  timeout: number
}): AsyncIteratorObject<readonly [MediaSource, (_: AbortSignal) => Mse]> =>
  closing(signal, async function* (signal) {
    using _ = defer(() => {
      if (media.src) {
        URL.revokeObjectURL(media.src)
      }
      media.removeAttribute("src")
      media.load()
    })

    for await (const source of bond(media, signal, timeout)) {
      yield [
        source,
        (sig) =>
          media_source({
            evict_before: () => media.currentTime - evict_behind,
            media,
            mime_type,
            source,
            signal: AbortSignal.any([signal, sig]),
            timeout,
          }),
      ]
    }
    return
  })

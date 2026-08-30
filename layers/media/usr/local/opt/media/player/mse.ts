import { abortion, closing, defer, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array<ArrayBuffer>
export type Mse = AsyncGenerator<void, void, MseOperation>

const EPSILON = 0.001

const op_lock = async function* (
  buffer: SourceBuffer,
  signal: AbortSignal,
): AsyncIteratorObject<undefined> {
  if (signal.aborted) {
    return
  }

  using a = abortion(signal)
  const changed = Promise.race([
    once(a.signal, buffer, "updateend"),
    once(a.signal, buffer, "error"),
  ])

  yield
  const event = await changed
  if (a.signal.aborted) {
    if (buffer.updating) {
      buffer.abort()
    }
    return
  }
  if (event?.type === "error") {
    throw event
  }
  return
}

export const media_source = async function* ({
  mime_type,
  source,
  evict_before,
  signal,
}: {
  mime_type: string
  source: MediaSource
  evict_before: () => number
  signal: AbortSignal
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

        for await (const _ of op_lock(buffer, a.signal)) {
          buffer.remove(end, end + EPSILON)
        }
      }
      {
        buffer.abort()
        buffer.timestampOffset = operation
      }
      continue
    }

    {
      const cutoff = evict_before()
      if (
        cutoff > 0 &&
        buffer.buffered.length &&
        buffer.buffered.start(0) < cutoff
      ) {
        for await (const _ of op_lock(buffer, a.signal)) {
          buffer.remove(0, cutoff)
        }
      }
      for await (const _ of op_lock(buffer, a.signal)) {
        buffer.appendBuffer(operation)
      }
    }
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

export const bond = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaSource> {
  using a = abortion(signal)

  while (!a.signal.aborted) {
    const source = MSE()
    const url = URL.createObjectURL(source)
    const opened = Promise.race([
      once(a.signal, source, "sourceopen"),
      once(a.signal, source, "sourceclose"),
    ])

    const prev = media.src

    try {
      media.src = url
      const event = await opened
      if (event?.type === "sourceclose") {
        throw event
      }
      if (event === undefined) {
        return
      }
    } catch (e) {
      URL.revokeObjectURL(url)
      throw e
    }

    if (prev) {
      URL.revokeObjectURL(prev)
    }
    yield source
  }

  return
}

export const media_sources = async function* ({
  media,
  mime_type,
  evict_behind,
  signal,
}: {
  media: HTMLMediaElement
  mime_type: string
  evict_behind: number
  signal: AbortSignal
}): AsyncIteratorObject<readonly [MediaSource, (_: AbortSignal) => Mse]> {
  using a = abortion(signal)
  using _ = defer(() => {
    if (media.src) {
      URL.revokeObjectURL(media.src)
    }
    media.removeAttribute("src")
    media.load()
  })

  for await (const source of closing(a.signal, (signal) =>
    bond(media, signal),
  )) {
    yield [
      source,
      (signal) =>
        media_source({
          evict_before: () => media.currentTime - evict_behind,
          mime_type,
          source,
          signal: AbortSignal.any([a.signal, signal]),
        }),
    ]
  }
  return
}

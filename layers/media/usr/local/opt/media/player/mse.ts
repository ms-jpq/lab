import { playable_position, POSITION_TOLERANCE } from "./media.ts"
import { abortion, closing, defer, event_batches, never, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array<ArrayBuffer>
export type Mse = AsyncIteratorObject<
  Uint8Array<ArrayBuffer>,
  void,
  MseOperation
>

const EPSILON = 0.001

export const closed = (source: MediaSource): boolean =>
  source.readyState === "closed"

const unbuffered_seek = async (
  media: HTMLMediaElement,
  buffer: SourceBuffer,
  signal: AbortSignal,
): Promise<{ type: "seeking" } | undefined> => {
  await using seeks = event_batches(signal, media, ["seeking"], () => undefined)
  seeking: for await (const _ of seeks) {
    if (signal.aborted) {
      return
    }
    if (!buffer.updating) {
      continue
    }
    const ranges = media.buffered
    const position = playable_position(media, media.currentTime)
    if (Math.abs(position - buffer.timestampOffset) <= POSITION_TOLERANCE) {
      continue
    }
    for (let index = 0; index < ranges.length; index += 1) {
      if (
        ranges.start(index) - position <= POSITION_TOLERANCE &&
        position - ranges.end(index) <= POSITION_TOLERANCE
      ) {
        continue seeking
      }
    }
    return { type: "seeking" }
  }
  return
}

const op_lock = async function* (
  {
    buffer,
    media,
    source,
    signal,
    timeout,
  }: {
    buffer: SourceBuffer
    media: HTMLMediaElement
    source: MediaSource
    signal: AbortSignal
    timeout: number
  },
  operation: "append" | "remove",
): AsyncIteratorObject<undefined> {
  if (signal.aborted) {
    return
  }

  const deadline = AbortSignal.timeout(timeout)
  using a = abortion(signal, deadline)
  const changed = Promise.race([
    ...(operation === "append"
      ? [unbuffered_seek(media, buffer, a.signal)]
      : []),
    once(a.signal, buffer, "update"),
    once(a.signal, buffer, "error"),
    once(a.signal, source, "sourceclose"),
  ])

  yield
  const event = await changed
  switch (event?.type) {
    case "error":
      throw event
    case undefined:
    case "seeking":
    case "sourceclose": {
      if (operation === "append" && buffer.updating) {
        buffer.abort()
      }
      if (event === undefined && deadline.aborted && !signal.aborted) {
        throw new Error("SourceBuffer operation timed out")
      }
    }
  }
  return
}

const empty = new Uint8Array(0)

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
  const lock = op_lock.bind(undefined, {
    buffer,
    media,
    source,
    signal: a.signal,
    timeout,
  })

  const position = (yield empty) as number
  if (a.signal.aborted) {
    return
  }
  buffer.timestampOffset = position

  let remaining = empty
  for (let operation = yield empty; ; operation = yield remaining) {
    remaining = empty

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

        for await (const _ of lock("remove")) {
          buffer.remove(end, end + EPSILON)
        }
        if (a.signal.aborted || closed(source)) {
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
        for await (const _ of lock("remove")) {
          buffer.remove(0, cutoff)
        }
        if (closed(source)) {
          return
        }
      }
      for await (const _ of lock("append")) {
        try {
          buffer.appendBuffer(operation)
        } catch (error) {
          if (
            error instanceof DOMException &&
            error.code === DOMException.QUOTA_EXCEEDED_ERR
          ) {
            remaining = operation
            break
          }
          throw error
        }
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
        using a = abortion(signal, deadline)
        const opened = Promise.race([
          once(a.signal, source, "sourceopen"),
          once(a.signal, source, "sourceclose"),
        ])
        media.src = url
        const event = await opened

        if (signal.aborted) {
          return
        }
        if (event === undefined && deadline.aborted) {
          throw new Error("MediaSource opening timed out")
        }
        if (event?.type === "sourceclose" || closed(source)) {
          throw event?.type === "sourceclose"
            ? event
            : new Error("MediaSource closed before handoff")
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

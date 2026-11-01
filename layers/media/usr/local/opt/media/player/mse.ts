import {
  contains_position,
  playable_position,
  POSITION_TOLERANCE,
} from "./media.ts"
import { abortion, closing, defer, never, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array<ArrayBuffer>
export type Mse = AsyncIteratorObject<
  Uint8Array<ArrayBuffer>,
  void,
  MseOperation
>

type BufferContext = {
  buffer: SourceBuffer
  media: HTMLMediaElement
  source: MediaSource
  signal: AbortSignal
  timeout: number
}

const EPSILON = 0.001

export const closed = (source: MediaSource): boolean =>
  source.readyState === "closed"

const unbuffered_seek = async (
  media: HTMLMediaElement,
  buffer: SourceBuffer,
  signal: AbortSignal,
  awaiting_start: boolean,
): Promise<{ type: "seeking" } | undefined> => {
  while (await once(signal, media, "seeking")) {
    if (signal.aborted) {
      return
    }
    if (!buffer.updating) {
      continue
    }
    const ranges = media.buffered
    const position = playable_position(media, media.currentTime)
    if (
      (awaiting_start &&
        Math.abs(position - buffer.timestampOffset) <= POSITION_TOLERANCE) ||
      contains_position(ranges, position)
    ) {
      continue
    }
    return { type: "seeking" }
  }
  return
}

const update_buffer = async (
  operation: BufferContext &
    (
      | {
          type: "append"
          data: Uint8Array<ArrayBuffer>
          awaiting_start: boolean
        }
      | { type: "remove"; start: number; end: number }
    ),
): Promise<undefined> => {
  const { buffer, media, source, signal, timeout } = operation
  if (signal.aborted || closed(source)) {
    return
  }

  const deadline = AbortSignal.timeout(timeout)
  using a = abortion(signal, deadline)
  const changed = Promise.race([
    ...(operation.type === "append"
      ? [unbuffered_seek(media, buffer, a.signal, operation.awaiting_start)]
      : []),
    once(a.signal, buffer, "update"),
    once(a.signal, buffer, "error"),
    once(a.signal, source, "sourceclose"),
  ])

  switch (operation.type) {
    case "append": {
      const { data } = operation
      buffer.appendBuffer(data)
      break
    }
    case "remove": {
      const { start, end } = operation
      buffer.remove(start, end)
      break
    }
  }

  const event = await changed
  switch (event?.type) {
    case "update":
      return
    case "error":
      throw event
  }

  if (operation.type === "append" && buffer.updating) {
    buffer.abort()
  }
  if (event === undefined && deadline.aborted && !signal.aborted) {
    throw new Error("SourceBuffer operation timed out")
  }
  return
}

const empty = new Uint8Array(0)

export const media_source = async function* ({
  media,
  mime_type,
  source,
  signal,
  timeout,
}: {
  media: HTMLMediaElement
  mime_type: string
  source: MediaSource
  signal: AbortSignal
  timeout: number
}): Mse {
  if (signal.aborted || closed(source)) {
    return
  }

  const buffer = source.addSourceBuffer(mime_type)
  const ctx = {
    buffer,
    media,
    source,
    signal,
    timeout,
  }

  const position = (yield empty) as number
  if (signal.aborted || closed(source)) {
    return
  }
  buffer.timestampOffset = position

  let awaiting_start = true
  for (
    let remaining: Uint8Array<ArrayBuffer> = empty, operation = yield remaining;
    !signal.aborted && !closed(source);
    operation = yield remaining
  ) {
    remaining = empty

    if (operation === undefined) {
      if (source.readyState !== "ended") {
        source.endOfStream()
      }
      continue
    }

    if (typeof operation === "number") {
      if (source.readyState === "ended") {
        const ranges = buffer.buffered
        const end = ranges.length ? ranges.end(ranges.length - 1) : 0

        await update_buffer({
          ...ctx,
          type: "remove",
          start: end,
          end: end + EPSILON,
        })
        if (signal.aborted || closed(source)) {
          return
        }
      }
      buffer.abort()
      buffer.timestampOffset = operation
      awaiting_start = true
      continue
    }

    if (!(operation instanceof Uint8Array)) {
      never(operation)
    }

    awaiting_start &&= !contains_position(
      media.buffered,
      buffer.timestampOffset,
    )
    try {
      await update_buffer({
        ...ctx,
        type: "append",
        data: operation,
        awaiting_start,
      })
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.code === DOMException.QUOTA_EXCEEDED_ERR
      ) {
        remaining = operation
      } else {
        throw error
      }
    }
    if (closed(source)) {
      return
    }
    awaiting_start &&= !contains_position(
      media.buffered,
      buffer.timestampOffset,
    )
  }
}

export const bond = (
  media: HTMLMediaElement,
  signal: AbortSignal,
  timeout: number,
): AsyncIteratorObject<MediaSource> =>
  closing(signal, async function* (signal) {
    for (; !signal.aborted;) {
      const Source =
        (
          globalThis as typeof globalThis & {
            ManagedMediaSource?: typeof MediaSource
          }
        ).ManagedMediaSource ?? MediaSource
      const source = new Source()
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
  signal,
  timeout,
}: {
  media: HTMLMediaElement
  mime_type: string
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
      using a = abortion(signal)
      source.addEventListener("sourceclose", a[Symbol.dispose], {
        once: true,
        signal: a.signal,
      })
      if (closed(source)) {
        continue
      }
      yield [
        source,
        (sig) =>
          media_source({
            media,
            mime_type,
            source,
            signal: AbortSignal.any([a.signal, sig]),
            timeout,
          }),
      ]
    }
    return
  })

import { abortion, defer, once } from "./util.ts"

export type MseOperation = undefined | number | Uint8Array
export type Mse = AsyncGenerator<void, void, MseOperation>

const EPSILON = 0.001

const op_lock = async function* (
  buffer: SourceBuffer,
): AsyncIteratorObject<undefined> {
  using a = abortion()
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
  mime_type,
  source,
  evict_before,
}: {
  mime_type: string
  source: MediaSource
  evict_before: () => number
}): Mse {
  const buffer = source.addSourceBuffer(mime_type)

  const position = (yield undefined) as unknown as number
  buffer.timestampOffset = position

  for (let operation = yield undefined; ; operation = yield undefined) {
    if (operation === undefined) {
      source.endOfStream()
      continue
    }

    if (typeof operation === "number") {
      if (source.readyState === "ended") {
        const ranges = buffer.buffered
        const end = ranges.length ? ranges.end(ranges.length - 1) : 0

        for await (const _ of op_lock(buffer)) {
          buffer.remove(end, end + EPSILON)
        }
      }
      buffer.abort()
      buffer.timestampOffset = operation
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
          buffer.remove(0, cutoff)
        }
      }
    }
    for await (const _ of op_lock(buffer)) {
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>)
    }
  }
}

const MSE = (): MediaSource => {
  const source = new (
    (
      globalThis as typeof globalThis & {
        ManagedMediaSource?: typeof MediaSource
      }
    ).ManagedMediaSource ?? MediaSource
  )()
  return source
}

export const setup = async function* (
  media: HTMLMediaElement,
): AsyncIteratorObject<MediaSource> {
  const source = MSE()
  const url = URL.createObjectURL(source)
  using _ = defer(() => {
    URL.revokeObjectURL(url)
  })

  using a = abortion()
  const opened = Promise.race([
    once(a.signal, source, "sourceopen"),
    once(a.signal, source, "sourceclose"),
  ])

  try {
    media.src = url
    await opened
    yield source
  } catch {
    URL.revokeObjectURL(url)
  } finally {
    media.removeAttribute("src")
    media.load()
  }
  return
}

const BEHIND = 30

export const media_sources = async function* (
  media: HTMLMediaElement,
  { seek, signal }: { seek: () => void; signal: AbortSignal },
): AsyncIteratorObject<Mse> {
  let url: string | undefined

  try {
    while (!signal.aborted) {
      const source = MSE()
      const url = URL.createObjectURL(source)
      using _m = setup(media, url)

      const previous = url
      const next = URL.createObjectURL(source)
      const event = await attach(media, {
        seek,
        signal,
        source,
        url: next,
      }).then(
        (value) => value,
        (error: unknown) => {
          revoke(next)
          throw error
        },
      )

      url = next
      revoke(previous)
      if (!event || signal.aborted) {
        return
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
        source,
      })
      await buffer.next()
      try {
        yield buffer
      } finally {
        await buffer.return()
      }
    }
  } finally {
    try {
    } finally {
      revoke(url)
    }
  }
  return
}

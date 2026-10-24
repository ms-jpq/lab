import { closed, media_sources } from "./mse.ts"
import type { Mse } from "./mse.ts"
import { media_buffered, media_events, playable_position } from "./media.ts"
import {
  duration,
  main,
  media,
  mime_type,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import { playback_transitions } from "./reducer.ts"
import type {
  PlaybackAction,
  PlaybackDispatch,
  PlaybackEffects,
} from "./reducer.ts"
import {
  abortion,
  closing,
  defer,
  delay,
  fetch_stream,
  inactivity,
  merge,
  never,
  once,
  typed_next,
} from "./util.ts"

type StreamAction = Extract<
  PlaybackAction,
  {
    type:
      "bytes_received" | "request_failed" | "request_finished" | "request_retry"
  }
>
type SourceAction = Extract<PlaybackAction, { type: "source_closed" }>

{
  for (const name of ["dispose", "asyncDispose"] as const) {
    if (Symbol[name] === undefined) {
      Object.defineProperty(Symbol, name, {
        value: Symbol.for(`Symbol.${name}`),
      })
    }
  }

  const aiter_proto = Object.getPrototypeOf(
    Object.getPrototypeOf(
      Object.getPrototypeOf(
        (async function* (): AsyncIteratorObject<never> {
          return
        })(),
      ),
    ),
  )

  if (!(Symbol.asyncDispose in aiter_proto)) {
    Object.defineProperty(aiter_proto, Symbol.asyncDispose, {
      value: async function (this: AsyncIterator<unknown>): Promise<void> {
        await this.return?.()
      },
    })
  }
}

const MSE_TIMEOUT = 10_000
const REQUEST_TIMEOUT = 15_000
const RETRY_DELAY = 1_000

const stream_events = async function* (
  stream: ReturnType<typeof fetch_stream>,
  signal: AbortSignal,
): AsyncIteratorObject<readonly StreamAction[]> {
  try {
    for await (const bytes of stream) {
      yield [{ bytes, type: "bytes_received" }]
    }
    if (!signal.aborted) {
      yield [{ type: "request_finished" }]
    }
  } catch (error) {
    if (signal.aborted) {
      return
    }
    yield [{ error, type: "request_failed" }]
  }
  if (await delay(signal, RETRY_DELAY)) {
    yield [{ current: media_buffered(media).current, type: "request_retry" }]
  }
  return
}

const source_events = async function* (
  signal: AbortSignal,
  source: MediaSource,
): AsyncIteratorObject<readonly SourceAction[]> {
  if (
    !closed(source) &&
    (await once(signal, source, "sourceclose")) === undefined
  ) {
    return
  }

  yield [
    {
      paused: media.paused,
      position:
        media.readyState >= media.HAVE_METADATA
          ? playable_position(media, media.currentTime)
          : undefined,
      type: "source_closed",
    },
  ]
  return
}

const playback_events = async function* (
  source: MediaSource,
  {
    signal,
    buffer,
    dispatch,
  }: { signal: AbortSignal; buffer: Mse; dispatch: PlaybackDispatch },
): AsyncIteratorObject<PlaybackEffects> {
  const abort = abortion(signal)
  await using observations = merge(
    media_events(media, abort.signal),
    source_events(abort.signal, source),
  )
  using _ = abort

  let pending_media = typed_next(observations, { type: "media" })
  let request:
    | {
        aiter: AsyncIteratorObject<readonly StreamAction[]>
        pending?: Promise<
          { type: "request" } & IteratorResult<readonly StreamAction[]>
        >
      }
    | undefined

  await using __ = defer(async () => {
    await request?.aiter.return?.()
  })

  let actions: readonly PlaybackAction[] = [{ type: "source_opened" }]
  for (; !abort.signal.aborted;) {
    const effects: PlaybackEffects = dispatch(actions)
    yield effects

    if (effects.control) {
      await request?.aiter.return?.()
      request = undefined
      switch (effects.control.type) {
        case "pause":
          break
        case "rebuild":
        case "retry":
          return
        case "request": {
          const { frontier, position } = effects.control.request
          if ((await buffer.next(frontier)).done) {
            return
          }
          const aiter = closing(abort.signal, (signal) =>
            stream_events(
              inactivity(signal, REQUEST_TIMEOUT, (signal) =>
                fetch_stream(
                  new Request(source_url(media, position), { signal }),
                ),
              ),
              signal,
            ),
          )
          request = { aiter }
          break
        }
        default:
          never(effects.control)
      }
    } else if (effects.buffer !== undefined) {
      const result = await buffer.next(effects.buffer.bytes)
      if (result.done) {
        return
      }
      if (effects.buffer.type !== "end" && result.value.byteLength > 0) {
        actions = [
          {
            ...media_buffered(media),
            type: "buffer_full",
            playable: media.readyState >= media.HAVE_FUTURE_DATA,
          },
        ]
        continue
      } else if (effects.buffer.type !== "end") {
        dispatch([media_buffered(media)])
      }
    }

    actions = []
    const selected = await Promise.race([
      pending_media,
      ...(request === undefined
        ? []
        : [request.pending ?? Promise.resolve({ type: "admit" as const })]),
    ])
    if (selected.type === "media") {
      if (selected.done) {
        return
      }
      pending_media = typed_next(observations, { type: "media" })
      const [, observed] = selected.value
      actions = observed
    } else if (request !== undefined) {
      if (selected.type === "admit") {
        request.pending = typed_next(request.aiter, { type: "request" })
      } else if (selected.done) {
        request = undefined
      } else {
        delete request.pending
        actions = selected.value
      }
    }
  }
  return
}

export const play_media = async (
  signal: AbortSignal,
  dispatch: PlaybackDispatch,
): Promise<void> => {
  using abort = abortion(signal)

  for await (const [source, create_buffer] of media_sources({
    media,
    mime_type,
    signal: abort.signal,
    timeout: MSE_TIMEOUT,
  })) {
    if (duration > 0) {
      source.duration = duration
    }

    await using buffer = create_buffer(abort.signal)
    let playing: Promise<void> | undefined
    await using _ = defer(async () => {
      const position =
        media.readyState >= media.HAVE_METADATA
          ? playable_position(media, media.currentTime)
          : undefined
      dispatch([{ type: "source_closed", paused: media.paused, position }])

      if (playing !== undefined) {
        media.pause()
        await playing
      }
    })

    if ((await buffer.next()).done) {
      continue
    }

    for await (const effects of playback_events(source, {
      signal: abort.signal,
      buffer,
      dispatch,
    })) {
      if (effects.error !== undefined) {
        console.error(effects.error)
      }
      if (effects.persist !== undefined) {
        persist_position(effects.persist)
      }
      if (effects.seek !== undefined) {
        media.currentTime = effects.seek
      }
      if (effects.play && playing === undefined) {
        playing = (async () => {
          try {
            await media.play()
          } catch (error) {
            if (!(
              error instanceof DOMException &&
              error.code === DOMException.ABORT_ERR
            )) {
              console.error(error)
            }
          }
        })()
      }
      if (effects.control?.type === "retry") {
        return
      }
    }
  }
  return
}

export const playback = async (signal: AbortSignal) => {
  const dispatch = playback_transitions(page_position())
  for (; !signal.aborted; await delay(signal, RETRY_DELAY)) {
    try {
      await play_media(signal, dispatch)
    } catch (error) {
      if (signal.aborted) {
        return
      }
      console.error(error)
    }
  }
  return
}

void main(playback).catch(console.error)

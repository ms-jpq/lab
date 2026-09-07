import { closed, media_sources } from "./mse.ts"
import { media_buffered, media_events, playable_position } from "./media.ts"
import type { MediaSnapshot } from "./media.ts"
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
} from "./util.ts"

type Dispatch = ReturnType<typeof playback_transitions>
type PlaybackAction = Parameters<Dispatch>[0]
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

const BUFFER_BEHIND = 30
const MSE_TIMEOUT = 10_000
const REQUEST_TIMEOUT = 15_000
const RETRY_DELAY = 1_000

const stream_events = async function* (
  stream: ReturnType<typeof fetch_stream>,
  signal: AbortSignal,
): AsyncIteratorObject<StreamAction> {
  try {
    for await (const bytes of stream) {
      yield { bytes, type: "bytes_received" }
    }
  } catch (error) {
    if (signal.aborted) {
      return
    }
    yield { error, type: "request_failed" }
    if (await delay(signal, RETRY_DELAY)) {
      yield { current: media_buffered(media).current, type: "request_retry" }
    }
    return
  }
  if (!signal.aborted) {
    yield { type: "request_finished" }
  }
  return
}

const source_events = async function* (
  signal: AbortSignal,
  source: MediaSource,
): AsyncIteratorObject<SourceAction> {
  if (
    !closed(source) &&
    (await once(signal, source, "sourceclose")) === undefined
  ) {
    return
  }

  yield {
    paused: media.paused,
    position:
      media.readyState >= media.HAVE_METADATA
        ? playable_position(media, media.currentTime)
        : undefined,
    type: "source_closed",
  }
  return
}

const playback_events = (
  signal: AbortSignal,
  source: MediaSource,
  position: number | undefined,
  previous: MediaSnapshot,
): AsyncIteratorObject<PlaybackAction> =>
  closing(signal, async function* (signal) {
    const current = media_buffered(media).current
    if (current.error !== undefined && current.error !== previous.error) {
      yield { current, type: "error" }
    }
    if (current.time !== previous.time) {
      yield { current, type: "seeking" }
    }
    await using stream =
      position === undefined
        ? (async function* () {})()
        : stream_events(
            inactivity(signal, REQUEST_TIMEOUT, (signal) =>
              fetch_stream(
                new Request(source_url(media, position), {
                  signal,
                }),
              ),
            ),
            signal,
          )

    await using events = merge(
      media_events(media, signal),
      source_events(signal, source),
      stream,
    )
    for await (const [, event] of events) {
      yield event
    }
    return
  })

export const play_media = async (signal: AbortSignal, dispatch: Dispatch) => {
  using abort = abortion(signal)

  source: for await (const [source, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
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
      dispatch({ type: "source_closed", paused: media.paused, position })

      if (playing !== undefined) {
        media.pause()
        await playing
      }
    })

    if ((await buffer.next()).done) {
      continue
    }

    const opened = dispatch({ type: "source_opened" })
    if (opened.seek !== undefined) {
      media.currentTime = opened.seek
    }

    let requested =
      opened.control?.type === "request" ? opened.control.request : undefined
    let previous = media_buffered(media).current

    request: for (; !abort.signal.aborted;) {
      if (
        requested !== undefined &&
        (await buffer.next(requested.frontier)).done
      ) {
        continue source
      }

      using abrt = abortion(abort.signal)

      for await (const received of playback_events(
        abrt.signal,
        source,
        requested?.position,
        previous,
      )) {
        const effects = dispatch(received)
        if (effects.error !== undefined) {
          console.error(effects.error)
        }

        if (effects.persist !== undefined) {
          persist_position(effects.persist)
        }

        if (effects.seek !== undefined) {
          media.currentTime = effects.seek
        }
        previous = media_buffered(media).current

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

        if (effects.control) {
          using _ = abrt

          switch (effects.control.type) {
            case "pause": {
              requested = undefined
              continue request
            }
            case "rebuild":
              continue source
            case "retry":
              return
            case "request": {
              requested = effects.control.request
              continue request
            }
            default:
              never(effects.control)
          }
        }

        if (effects.buffer) {
          const operation = (() => {
            switch (effects.buffer.type) {
              case "append":
                return effects.buffer.bytes
              case "end":
                return undefined
              default:
                return never(effects.buffer)
            }
          })()

          const result = await buffer.next(operation)
          if (result.done) {
            using _ = abrt
            continue source
          }

          if (effects.buffer.type === "append") {
            if (result.value.byteLength > 0) {
              const { control } = dispatch({
                ...media_buffered(media),
                type: "buffer_full",
              })
              if (control?.type === "retry") {
                return
              }
              requested = undefined
              using _ = abrt
              continue request
            }
            dispatch(media_buffered(media))
          }
        }
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

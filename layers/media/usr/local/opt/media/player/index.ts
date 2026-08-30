import { media_sources } from "./mse.ts"
import { media_events } from "./media.ts"
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
import { abortion, closing, delay, fetch_stream, merge, never } from "./util.ts"

type Dispatch = ReturnType<typeof playback_transitions>
type PlaybackAction = Parameters<Dispatch>[0]
type StreamAction = Extract<
  PlaybackAction,
  {
    type: "bytes_received" | "request_failed" | "request_finished"
  }
>

const BUFFER_BEHIND = 30

const request = (signal: AbortSignal, time: number): Request =>
  new Request(source_url(media, time), { signal })

const stream_events = async function* (
  stream: ReturnType<typeof fetch_stream>,
  signal: AbortSignal,
): AsyncIteratorObject<StreamAction> {
  try {
    for await (const bytes of stream) {
      if (bytes !== undefined) {
        yield { bytes, type: "bytes_received" }
      }
    }
  } catch (error) {
    if (!signal.aborted) {
      yield { error, type: "request_failed" }
    }
    return
  }
  if (!signal.aborted) {
    yield { type: "request_finished" }
  }
  return
}

const playback_events = (
  signal: AbortSignal,
  position: number | undefined,
): AsyncIteratorObject<PlaybackAction> =>
  closing(signal, async function* (signal) {
    const states = media_events(media, signal)
    if (position === undefined) {
      yield* states
      return
    }

    await using stream = fetch_stream(request(signal, position))
    await using events = merge(states, stream_events(stream, signal))
    for await (const [, event] of events) {
      yield event
    }
    return
  })

export const play_media = async (signal: AbortSignal) => {
  using abort = abortion(signal)
  const dispatch = playback_transitions(page_position())

  source: for await (const [source, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type,
    signal: abort.signal,
  })) {
    if (duration > 0) {
      source.duration = duration
    }

    await using buffer = create_buffer(abort.signal)

    if ((await buffer.next()).done) {
      continue
    }

    const opened = dispatch({ type: "source_opened" })
    if (opened.seek !== undefined) {
      media.currentTime = opened.seek
    }

    let requested =
      opened.control?.type === "request" ? opened.control.request : undefined

    request: while (!abort.signal.aborted) {
      if (
        requested !== undefined &&
        (await buffer.next(requested.frontier)).done
      ) {
        continue source
      }

      using abrt = abortion(abort.signal)
      using _ = abrt

      for await (const event of playback_events(
        abrt.signal,
        requested?.position,
      )) {
        const effects = dispatch(event)
        if (effects.error !== undefined) {
          console.error(effects.error)
        }

        if (effects.persist !== undefined) {
          persist_position(effects.persist)
        }

        if (effects.seek !== undefined) {
          media.currentTime = effects.seek
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

          if ((await buffer.next(operation)).done) {
            using _ = abrt
            continue source
          }
        }
      }
    }
  }
  return
}

export const playback = async (signal: AbortSignal) => {
  while (!signal.aborted) {
    try {
      await play_media(signal)
    } catch (error) {
      if (signal.aborted) {
        return
      }
      console.error(error)
    }
    if (!(await delay(signal, 1_000))) {
      return
    }
  }
  return
}

void main(playback).catch(console.error)

import { media_sources } from "./mse.ts"
import { media_events } from "./media.ts"
import {
  main,
  media,
  mime_type,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import { playback_transitions } from "./reducer.ts"
import { abortion, delay, fetch_stream, merge } from "./util.ts"

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

export const play_media = async (signal: AbortSignal) => {
  using abort = abortion(signal)
  const dispatch = playback_transitions(media, page_position())

  source: for await (const [, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type,
    signal: abort.signal,
  })) {
    await using buffer = create_buffer(abort.signal)

    if ((await buffer.next()).done) {
      continue
    }

    const opened = dispatch({ type: "source_opened" })
    if (opened.seek !== undefined) {
      media.currentTime = opened.seek
    }
    let requested = opened.request

    while (requested !== undefined && !abort.signal.aborted) {
      if ((await buffer.next(requested.frontier)).done) {
        continue source
      }

      using abrt = abortion(abort.signal)
      await using stream = fetch_stream(
        request(abrt.signal, requested.position),
      )
      using _ = abrt

      for await (const [, event] of merge(
        media_events(media, abrt.signal),
        stream_events(stream, abrt.signal),
      )) {
        const effects = dispatch(event)

        if (effects.report !== undefined) {
          console.error(effects.report)
        }

        if (effects.persist !== undefined) {
          persist_position(effects.persist)
        }

        if (effects.seek !== undefined) {
          media.currentTime = effects.seek
        }

        if (effects.append) {
          if ((await buffer.next(effects.append)).done) {
            using _ = abrt
            continue source
          }
        }

        if (effects.end) {
          if ((await buffer.next(undefined)).done) {
            using _ = abrt
            continue source
          }
        }

        if (effects.request !== undefined) {
          requested = effects.request
          if (effects.failure === undefined) {
            using _ = abrt
            break
          }
        }

        if (effects.failure !== undefined) {
          console.error(effects.failure)
          using _ = abrt
          continue source
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

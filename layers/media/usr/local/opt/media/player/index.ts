import { media_sources, type MseOperation } from "./mse.ts"
import {
  main,
  media,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import { playback_events, playback_transitions } from "./reducer.ts"
import {
  abortion,
  defer,
  delay,
  logical_stream,
  merge,
  readableIterator,
} from "./util.ts"

const BUFFER_BEHIND = 30

export const play_media = async (signal: AbortSignal): Promise<undefined> => {
  const abort = abortion(signal)

  const [initial, reduce] = playback_transitions(media, page_position())
  let state = initial

  source: for await (const [source, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: abort.signal,
  })) {
    using abrt = abortion(abort.signal)
    await using buffer = create_buffer(abrt.signal)

    await using _ = defer(async () => {})
    for await (const event of playback_events(media, signal)) {
      if (event.type === "action") {
        const effects = transition(event.action)
        if (effects.persist !== undefined) {
          persist_position(effects.persist)
        }
        if (effects.seek !== undefined) {
          media.currentTime = effects.seek
        }

        const { interrupt: interruption } = effects
        if (interruption?.type === "failure") {
          console.error(interruption.error)
          continue source
        }
        if (interruption?.type === "request") {
          request_open = true
          reset_stream = stream !== undefined
          stream_abort?.[Symbol.dispose]()
        }
      }

      if (event.type === "failure") {
        work = undefined
        if (event.owner === "stream" && stream_abort?.signal.aborted) {
          reset_stream = true
        } else if (event.owner === "stream") {
          console.error(event.error)
          transition({ type: "request_failed" })
          request_open = true
          reset_stream = true
          stream_abort?.[Symbol.dispose]()
        } else {
          console.error(event.error)
          continue source
        }
      }

      if (event.type === "buffer") {
        work = undefined
        if (event.result.done) {
          continue source
        }
        if (event.next === "stream" && !reset_stream) {
          read()
        }
      }

      if (event.type === "stream") {
        work = undefined
        if (event.result.done) {
          await close_stream()
          request_open = false
          send(undefined, "idle")
        } else {
          send(event.result.value, "stream")
        }
      }

      if (reset_stream && work === undefined) {
        await close_stream()
        reset_stream = false
      }
      if (
        work === undefined &&
        stream === undefined &&
        request_open &&
        playback.request.needed
      ) {
        stream_abort = abortion(abrt.signal)
        stream = logical_stream(
          new Request(source_url(media, playback.request.position), {
            signal: stream_abort.signal,
          }),
        )
        send(playback.request.frontier, "stream")
      }
    }
  }
  return undefined
}

export const playback = async (signal: AbortSignal): Promise<undefined> => {
  while (!signal.aborted) {
    try {
      await play_media(signal)
    } catch (error) {
      if (signal.aborted) {
        return undefined
      }
      console.error(error)
    }
    if (!(await delay(signal, 1_000))) {
      return undefined
    }
  }
  return undefined
}

void main(playback).catch(console.error)

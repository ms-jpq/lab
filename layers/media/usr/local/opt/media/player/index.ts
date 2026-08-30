import { media_sources } from "./mse.ts"
import {
  main,
  media,
  mime_type,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import { playback_events, playback_transitions } from "./reducer.ts"
import { abortion, delay, logical_stream } from "./util.ts"

const BUFFER_BEHIND = 30

const request = (signal: AbortSignal, time: number): Request =>
  new Request(source_url(media, time), { signal })

export const play_media = async (signal: AbortSignal) => {
  using abort = abortion(signal)
  const dispatch = playback_transitions(media, page_position())

  source: for await (const [, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type,
    signal: abort.signal,
  })) {
    using abrt = abortion(abort.signal)
    await using buffer = create_buffer(abrt.signal)
    await using stream = logical_stream(request(abrt.signal, page_position()))
    using _ = abrt

    if ((await buffer.next()).done) {
      continue
    }

    for await (const event of playback_events(media, abrt.signal)) {
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
          continue source
        }
      }

      if (effects.end) {
        if ((await buffer.next(undefined)).done) {
          continue source
        }
      }

      if (effects.request !== undefined) {
        if ((await buffer.next(effects.request.frontier)).done) {
          continue source
        }

        const r = await stream.next(
          request(abrt.signal, effects.request.position),
        )
        if (r.done) {
          continue source
        }

        await buffer.next(r.value)
      }

      switch (effects.interrupt?.type) {
        case "failure": {
          console.error(effects.interrupt.error)
          continue source
        }
        case "request":
        case undefined: {
          break
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

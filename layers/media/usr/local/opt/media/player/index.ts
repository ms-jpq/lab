import { closed, media_sources } from "./mse.ts"
import { media_buffered, media_events } from "./media.ts"
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
      if (bytes !== undefined) {
        yield { bytes, type: "bytes_received" }
      }
    }
  } catch (error) {
    if (signal.aborted) {
      return
    }
    yield { error, type: "request_failed" }
    if (await delay(signal, RETRY_DELAY)) {
      yield { type: "request_retry" }
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
  const action = { type: "source_closed" } as const
  if (closed(source)) {
    yield action
    return
  }
  if ((await once(signal, source, "sourceclose")) !== undefined) {
    yield action
  }
  return
}

const playback_events = (
  signal: AbortSignal,
  source: MediaSource,
  position: number | undefined,
): AsyncIteratorObject<PlaybackAction> =>
  closing(signal, async function* (signal) {
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

export const play_media = async (signal: AbortSignal) => {
  using abort = abortion(signal)
  const dispatch = playback_transitions(page_position())

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

      for await (const received of playback_events(
        abrt.signal,
        source,
        requested?.position,
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
          if (effects.buffer.type === "append") {
            dispatch(media_buffered(media))
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

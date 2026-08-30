import { media_sources, type Mse, type MseOperation } from "./mse.ts"
import {
  main,
  media,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import {
  initial_playback,
  media_events,
  reduce,
  type MediaAction,
  type PlaybackAction,
  type PlaybackInterruption,
} from "./reducer.ts"
import { abortion, logical_stream } from "./util.ts"

type Abortion = ReturnType<typeof abortion>

type Action = Readonly<{
  result: IteratorResult<MediaAction>
  type: "action"
}>

type BufferWork = Readonly<{
  next: "idle" | "stream"
  result: IteratorResult<void>
  type: "buffer"
}>

type Stream = ReturnType<typeof logical_stream>

type StreamWork = Readonly<{
  result: IteratorResult<Uint8Array<ArrayBuffer>, undefined>
  type: "stream"
}>

type Work =
  | BufferWork
  | StreamWork
  | Readonly<{
      error: unknown
      owner: "buffer" | "stream"
      type: "failure"
    }>

const BUFFER_BEHIND = 30

export const play_media = async (signal: AbortSignal): Promise<undefined> => {
  using lifetime = abortion(signal)
  const actions = media_events(media, lifetime.signal)
  const sources = media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })

  let playback = initial_playback(media, page_position())

  const read_action = async (): Promise<Action> => ({
    result: await actions.next(),
    type: "action",
  })
  let pending_action = read_action()

  const dispatch = (
    action: PlaybackAction,
  ): PlaybackInterruption | undefined => {
    const [state, effects] = reduce(playback, action)
    playback = state

    if (effects.persist !== undefined) {
      persist_position(effects.persist)
    }
    if (effects.seek !== undefined) {
      media.currentTime = effects.seek
    }
    return effects.interrupt
  }

  try {
    source: for (;;) {
      using source_lifetime = abortion(lifetime.signal)
      let buffer: Mse | undefined
      let stream: Stream | undefined
      let request_lifetime: Abortion | undefined
      let work: Promise<Work> | undefined

      const close_stream = async (): Promise<void> => {
        request_lifetime?.[Symbol.dispose]()
        request_lifetime = undefined
        const current = stream
        stream = undefined
        await current?.return(undefined)
      }

      try {
        const opened = await sources.next()
        if (opened.done) {
          return undefined
        }

        const [source, create_buffer] = opened.value
        if (playback.current.duration > 0) {
          source.duration = playback.current.duration
        }

        buffer = create_buffer(source_lifetime.signal)
        if ((await buffer.next()).done) {
          continue
        }
        dispatch({ type: "source_opened" })

        const send = (
          operation: MseOperation,
          next: BufferWork["next"],
        ): void => {
          work = buffer?.next(operation).then(
            (result) => ({ next, result, type: "buffer" }),
            (error) => ({ error, owner: "buffer", type: "failure" }),
          )
        }
        const read = (): void => {
          work = stream?.next().then(
            (result) => ({ result, type: "stream" }),
            (error) => ({ error, owner: "stream", type: "failure" }),
          )
        }

        let request_open = true
        let reset_stream = false

        for (;;) {
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
            request_lifetime = abortion(source_lifetime.signal)
            stream = logical_stream(
              new Request(source_url(media, playback.request.position), {
                signal: request_lifetime.signal,
              }),
            )
            send(playback.request.frontier, "stream")
          }

          const selected = await Promise.race(
            work === undefined ? [pending_action] : [pending_action, work],
          )

          if (selected.type === "action") {
            const { result } = selected
            if (result.done) {
              return undefined
            }
            pending_action = read_action()

            const interruption = dispatch(result.value)
            if (interruption?.type === "failure") {
              console.error(interruption.error)
              source_lifetime[Symbol.dispose]()
              continue source
            }
            if (interruption?.type === "request") {
              request_open = true
              reset_stream = stream !== undefined
              request_lifetime?.[Symbol.dispose]()
            }
            continue
          }

          work = undefined
          if (selected.type === "failure") {
            if (
              selected.owner === "stream" &&
              request_lifetime?.signal.aborted
            ) {
              continue
            }
            console.error(selected.error)
            source_lifetime[Symbol.dispose]()
            continue source
          }

          if (selected.type === "buffer") {
            if (selected.result.done) {
              continue source
            }
            if (selected.next === "stream" && !reset_stream) {
              read()
            }
            continue
          }

          if (selected.result.done) {
            await close_stream()
            request_open = false
            send(undefined, "idle")
            continue
          }
          send(selected.result.value, "stream")
        }
      } catch (error) {
        if (lifetime.signal.aborted) {
          return undefined
        }
        console.error(error)
      } finally {
        source_lifetime[Symbol.dispose]()
        await work
        try {
          await close_stream()
        } finally {
          await buffer?.return(undefined)
        }
      }
    }
  } finally {
    lifetime[Symbol.dispose]()
    try {
      await sources.return?.()
    } finally {
      await actions.return?.()
    }
  }
}

void main(play_media).catch(console.error)

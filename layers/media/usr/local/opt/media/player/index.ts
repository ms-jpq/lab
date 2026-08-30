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
import { abortion, defer, delay, logical_stream } from "./util.ts"

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
  const abort = abortion(signal)

  await using actions = media_events(media, abort.signal)
  await using sources = media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: abort.signal,
  })
  using _ = abort

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

  source: for await (const [source, create_buffer] of sources) {
    const abrt = abortion(abort.signal)

    let stream: Stream | undefined
    let work: Promise<Work> | undefined

    const close_stream = async (): Promise<void> => {
      abrt?.[Symbol.dispose]()
      const current = stream
      stream = undefined
      await current?.return(undefined)
    }

    if (playback.current.duration > 0) {
      source.duration = playback.current.duration
    }

    const buffer = create_buffer(abrt.signal)
    await using _buffer = buffer
    await using _cleanup = defer(async () => {
      await work
      await close_stream()
    })
    using _preabort = abrt

    if ((await buffer.next()).done) {
      continue
    }
    dispatch({ type: "source_opened" })

    const send = (operation: MseOperation, next: BufferWork["next"]): void => {
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
      const a = abortion(abrt.signal)
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
        stream = logical_stream(
          new Request(source_url(media, playback.request.position), {
            signal: a.signal,
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
          continue source
        }
        if (interruption?.type === "request") {
          request_open = true
          reset_stream = stream !== undefined
          abrt?.[Symbol.dispose]()
        }
        continue
      }

      work = undefined
      if (selected.type === "failure") {
        if (selected.owner === "stream" && abrt?.signal.aborted) {
          continue
        }
        console.error(selected.error)
        if (selected.owner === "stream") {
          dispatch({ type: "request_failed" })
          request_open = true
          reset_stream = true
          abrt?.[Symbol.dispose]()
          continue
        }
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
  }
}

void main(async (signal) => {
  for (;;) {
    try {
      await play_media(signal)
    } catch (error) {
      if (signal.aborted) {
        return undefined
      }
      console.error(error)
    }
    await delay(signal, 1_000)
  }
}).catch(console.error)

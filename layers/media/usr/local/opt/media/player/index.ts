import { media_sources, type MseOperation } from "./mse.ts"
import {
  main,
  media,
  page_position,
  persist_position,
  source_url,
} from "./page.ts"
import { playback_events, playback_transitions } from "./reducer.ts"
import { abortion, defer, delay, logical_stream } from "./util.ts"

type Abortion = ReturnType<typeof abortion>

type ReducerEvent =
  ReturnType<typeof playback_events> extends AsyncIteratorObject<infer T>
    ? T
    : never

type Action = Readonly<{
  result: IteratorResult<ReducerEvent>
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
  await using events = playback_events(media, abort.signal)
  using _ = abort

  const [initial, reduce] = playback_transitions(media, page_position())

  let playback = initial
  type PlaybackAction = Parameters<typeof reduce>[1]

  const read_action = async (): Promise<Action> => ({
    result: await events.next(),
    type: "action",
  })
  let pending_action = read_action()

  const transition = (action: PlaybackAction) => {
    const [state, effects] = reduce(playback, action)
    playback = state
    return effects
  }

  source: for await (const [source, create_buffer] of media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: abort.signal,
  })) {
    using abrt = abortion(abort.signal)
    await using buffer = create_buffer(abrt.signal)
    await using _ = defer(async () => {
      await work
      await close_stream()
    })
    using __ = abrt

    if (playback.current.duration > 0) {
      source.duration = playback.current.duration
    }

    let stream_abort: Abortion | undefined
    let stream: Stream | undefined
    let work: Promise<Work> | undefined

    const close_stream = async (): Promise<void> => {
      stream_abort?.[Symbol.dispose]()
      stream_abort = undefined
      const current = stream
      stream = undefined
      await current?.return(undefined)
    }

    if ((await buffer.next()).done) {
      continue
    }
    const opened = transition({ type: "source_opened" })
    if (opened.persist !== undefined) {
      persist_position(opened.persist)
    }
    if (opened.seek !== undefined) {
      media.currentTime = opened.seek
    }

    const send = (operation: MseOperation, next: BufferWork["next"]): void => {
      work = buffer.next(operation).then(
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
        stream_abort = abortion(abrt.signal)
        stream = logical_stream(
          new Request(source_url(media, playback.request.position), {
            signal: stream_abort.signal,
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

        const effects = transition(result.value)
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
        continue
      }

      work = undefined
      if (selected.type === "failure") {
        if (selected.owner === "stream" && stream_abort?.signal.aborted) {
          continue
        }
        console.error(selected.error)
        if (selected.owner === "stream") {
          transition({ type: "request_failed" })
          request_open = true
          reset_stream = true
          stream_abort?.[Symbol.dispose]()
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

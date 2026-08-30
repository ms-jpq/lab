import { media_sources, type Mse } from "./mse.ts"
import {
  media,
  page_position,
  persist_position,
  source_url,
  main,
} from "./page.ts"
import {
  initial_playback,
  media_events,
  reduce,
  type MediaAction,
  type PlaybackAction,
  type PlaybackInterruption,
} from "./reducer.ts"
import { abortion, delay, logical_stream } from "./util.ts"

type Stop = symbol

type Performed<T> =
  | Stop
  | Readonly<{
      interrupted: boolean
      value: T
    }>

type Settled<T> =
  | Readonly<{ error: unknown; type: "failure" }>
  | Readonly<{ type: "value"; value: T }>

const BUFFER_BEHIND = 30
const RETRY_DELAY = 1_000

const STOP: Stop = Symbol()

const stopped = (value: unknown): value is Stop => value === STOP

const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(
    (value) => ({ type: "value", value }),
    (error) => ({ error, type: "failure" }),
  )

export const play_media = async (signal: AbortSignal): Promise<void> => {
  using lifetime = abortion(signal)
  const sources = media_sources({
    evict_behind: BUFFER_BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })

  const states = media_events(media, lifetime.signal)
  if (lifetime.signal.aborted) {
    return
  }
  let playback = initial_playback(media, page_position())
  let interruption: PlaybackInterruption | undefined

  const dispatch = (action: PlaybackAction): void => {
    const [state, effects] = reduce(playback, action)
    const { persist, seek } = effects
    playback = state
    interruption ??= effects.interrupt
    if (persist !== undefined) {
      persist_position(persist)
    }
    if (seek !== undefined) {
      media.currentTime = seek
    }
  }
  const take_failure = (): MediaError | undefined => {
    if (interruption?.type !== "failure") {
      return undefined
    }
    const { error } = interruption
    interruption = undefined
    return error
  }
  const should_interrupt = (): boolean => interruption !== undefined
  const next_request = (): boolean => {
    const error = take_failure()
    if (error !== undefined) {
      throw error
    }
    if (interruption?.type !== "request") {
      return false
    }
    interruption = undefined
    return true
  }
  const read_state = async () =>
    ({ kind: "state", result: await states.next() }) as const
  let pending_state = read_state()
  const accept = (result: IteratorResult<MediaAction>): boolean => {
    if (result.done) {
      return false
    }
    pending_state = read_state()
    dispatch(result.value)
    return true
  }
  const wait = async (until: () => boolean): Promise<boolean> => {
    for (;;) {
      if (!accept((await pending_state).result)) {
        return false
      }
      if (until()) {
        return true
      }
    }
  }
  const perform = async <T>(
    promise: Promise<T>,
    until: () => boolean = () => false,
    interrupt: () => void = () => undefined,
  ): Promise<Performed<T>> => {
    const effect = promise.then(
      (value) => ({ kind: "effect", value }) as const,
      (error) => ({ kind: "failure", error }) as const,
    )
    let interrupted = false
    for (;;) {
      const selected = await Promise.race(
        interrupted ? [effect, pending_state] : [pending_state, effect],
      )
      if (selected.kind === "failure") {
        throw selected.error
      }
      if (selected.kind === "effect") {
        return { interrupted, value: selected.value }
      }
      if (!accept(selected.result)) {
        if (!interrupted) {
          interrupt()
        }
        const completed = await effect
        if (completed.kind === "failure") {
          throw completed.error
        }
        return STOP
      }
      if (!interrupted && until()) {
        interrupted = true
        interrupt()
      }
    }
  }
  const pull = async <T, R>(
    promise: Promise<IteratorResult<T, R>>,
  ): Promise<T | Stop> => {
    const performed = await perform(promise)
    return stopped(performed) || performed.value.done
      ? STOP
      : performed.value.value
  }
  const retry = async (until: () => boolean): Promise<boolean | Stop> => {
    using timer = abortion(lifetime.signal)
    const performed = await perform(
      delay(timer.signal, RETRY_DELAY),
      until,
      timer[Symbol.dispose],
    )
    return stopped(performed) ? STOP : performed.interrupted
  }

  const open = async (): Promise<Mse | Stop> => {
    const opened = await pull(sources.next())
    if (stopped(opened)) {
      return STOP
    }

    const [source, create_buffer] = opened
    if (playback.current.duration > 0) {
      source.duration = playback.current.duration
    }
    const buffer = create_buffer(lifetime.signal)
    if (stopped(await pull(buffer.next()))) {
      return STOP
    }

    const error = take_failure()
    if (error !== undefined) {
      throw error
    }
    return buffer
  }

  try {
    source: for (;;) {
      const media_failure = take_failure()
      if (media_failure !== undefined) {
        console.error(media_failure)
      }
      const opened = await settle(open())
      if (opened.type === "failure") {
        console.error(opened.error)
        const interrupted = await retry(should_interrupt)
        if (stopped(interrupted)) {
          return
        }
        if (interrupted) {
          take_failure()
        }
        continue
      }
      const { value: buffer } = opened
      if (stopped(buffer)) {
        return
      }
      dispatch({ type: "source_opened" })

      request: for (;;) {
        let request_failure: { error: unknown } | undefined
        try {
          if (next_request()) {
            continue request
          }
          while (!playback.request.needed) {
            const demanded = await wait(
              () => should_interrupt() || playback.request.needed,
            )
            if (!demanded) {
              return
            }
            if (next_request()) {
              continue request
            }
          }

          using owner = abortion(lifetime.signal)
          const start = playback.request.position
          const request = logical_stream(
            new Request(source_url(media, start), { signal: owner.signal }),
          )
          try {
            if (stopped(await pull(buffer.next(playback.request.frontier)))) {
              return
            }
            if (next_request()) {
              continue request
            }

            for (;;) {
              const received = await settle(
                perform(
                  request.next(),
                  should_interrupt,
                  owner[Symbol.dispose],
                ),
              )
              if (received.type === "failure") {
                request_failure = { error: received.error }
                break
              }
              const { value: read } = received
              if (stopped(read)) {
                return
              }
              if (read.interrupted) {
                next_request()
                continue request
              }
              if (read.value.done) {
                if (stopped(await pull(buffer.next(undefined)))) {
                  return
                }
                if (!(await wait(should_interrupt))) {
                  return
                }
                continue request
              }

              if (stopped(await pull(buffer.next(read.value.value)))) {
                return
              }
              if (next_request()) {
                continue request
              }
            }
          } finally {
            owner[Symbol.dispose]()
            await request.return(undefined)
          }
        } catch (error) {
          if (stopped(await perform(Promise.resolve()))) {
            return
          }
          console.error(take_failure() ?? error)
          continue source
        }

        if (request_failure !== undefined) {
          console.error(request_failure.error)
          dispatch({ type: "request_failed" })
          if (stopped(await retry(should_interrupt))) {
            return
          }
        }
      }
    }
  } finally {
    lifetime[Symbol.dispose]()
    try {
      await sources.return?.()
    } finally {
      await states.return?.()
    }
  }
}

void main(async (signal) => {
  await play_media(signal)
  return undefined
}).catch(console.error)

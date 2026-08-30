import { media_sources, type Mse } from "./mse.ts"
import {
  media,
  page_position,
  persist_position,
  run_playback,
  source_url,
  start_page,
} from "./page.ts"
import {
  initial_playback,
  media_events,
  play_ahead,
  reduce,
  should_interrupt,
  type MediaState,
  type PlaybackAction,
} from "./reducer.ts"
import { abortion, delay, logical_stream } from "./util.ts"

const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000

const STOP = Symbol()

type Performed<T> =
  | typeof STOP
  | Readonly<{
      interrupted: boolean
      value: T
    }>

export const decide = async (signal: AbortSignal): Promise<void> => {
  using lifetime = abortion(signal)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })

  const states = media_events(media, lifetime.signal)
  const initial = await states.next()
  if (initial.done) {
    return
  }
  let playback = initial_playback(page_position(), initial.value)

  const dispatch = (action: PlaybackAction): void => {
    const [state, { persist, seek }] = reduce(playback, action)
    playback = state
    if (persist !== undefined) {
      persist_position(persist)
    }
    if (seek !== undefined) {
      media.currentTime = seek
    }
  }
  const take_failure = (): MediaError | undefined => {
    const error = playback.failure
    dispatch({ kind: "consume_failure" })
    return error
  }
  const restart_request = (): boolean => {
    const error = take_failure()
    if (error !== undefined) {
      throw error
    }
    if (playback.stream.restart === undefined) {
      return false
    }
    dispatch({ kind: "stream_started" })
    return true
  }
  const read_state = async () =>
    ({ kind: "state", result: await states.next() }) as const
  let pending_state = read_state()
  const accept = (result: IteratorResult<MediaState>): boolean => {
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
  ): Promise<T | typeof STOP> => {
    const performed = await perform(promise)
    return performed === STOP || performed.value.done
      ? STOP
      : performed.value.value
  }
  const retry = async (
    until: () => boolean,
  ): Promise<boolean | typeof STOP> => {
    using timer = abortion(lifetime.signal)
    const performed = await perform(
      delay(timer.signal, RETRY_DELAY),
      until,
      timer[Symbol.dispose],
    )
    return performed === STOP ? STOP : performed.interrupted
  }

  const open = async (): Promise<Mse | typeof STOP> => {
    dispatch({ kind: "seek", target: playback.target })
    const opened = await pull(sources.next())
    if (opened === STOP) {
      return STOP
    }

    const [source, create_buffer] = opened
    if (playback.current.duration > 0) {
      source.duration = playback.current.duration
    }
    const buffer = create_buffer(lifetime.signal)
    if ((await pull(buffer.next())) === STOP) {
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
      const attempt = playback.target
      let buffer: Mse | typeof STOP
      try {
        buffer = await open()
      } catch (error) {
        console.error(error)
        const interrupted = await retry(
          () =>
            playback.failure !== undefined ||
            (playback.target !== attempt && playback.target.restart),
        )
        if (interrupted === STOP) {
          return
        }
        if (interrupted) {
          take_failure()
        }
        continue
      }
      if (buffer === STOP) {
        return
      }
      dispatch({ kind: "stream_started" })

      request: for (;;) {
        let request_failure: { error: unknown } | undefined
        try {
          if (restart_request()) {
            continue request
          }
          while (
            play_ahead(playback.current, playback.stream.start) >= BUFFER.LO
          ) {
            const demanded = await wait(
              () =>
                should_interrupt(playback) ||
                play_ahead(playback.current, playback.stream.start) < BUFFER.LO,
            )
            if (!demanded) {
              return
            }
            if (restart_request()) {
              continue request
            }
          }

          using owner = abortion(lifetime.signal)
          const start = playback.stream.start
          const request = logical_stream(
            new Request(source_url(media, start), { signal: owner.signal }),
          )
          try {
            if ((await pull(buffer.next(playback.stream.frontier))) === STOP) {
              return
            }
            if (restart_request()) {
              continue request
            }

            for (;;) {
              let read: Performed<IteratorResult<Uint8Array, undefined>>
              try {
                read = await perform(
                  request.next(),
                  () => should_interrupt(playback),
                  owner[Symbol.dispose],
                )
              } catch (error) {
                request_failure = { error }
                break
              }
              if (read === STOP) {
                return
              }
              if (read.interrupted) {
                restart_request()
                continue request
              }
              if (read.value.done) {
                if ((await pull(buffer.next(undefined))) === STOP) {
                  return
                }
                if (!(await wait(() => should_interrupt(playback)))) {
                  return
                }
                continue request
              }

              if ((await pull(buffer.next(read.value.value))) === STOP) {
                return
              }
              dispatch({ advance: false, kind: "frontier" })
              if (restart_request()) {
                continue request
              }
              if (
                play_ahead(playback.current, playback.stream.frontier) >=
                BUFFER.HI
              ) {
                dispatch({ advance: true, kind: "frontier" })
                continue request
              }
            }
          } finally {
            owner[Symbol.dispose]()
            await request.return(undefined)
          }
        } catch (error) {
          if ((await perform(Promise.resolve())) === STOP) {
            return
          }
          console.error(take_failure() ?? error)
          continue source
        }

        if (request_failure !== undefined) {
          console.error(request_failure.error)
          dispatch({ advance: true, kind: "frontier" })
          if ((await retry(() => should_interrupt(playback))) === STOP) {
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

void start_page((signal) => run_playback(signal, decide)).catch(console.error)

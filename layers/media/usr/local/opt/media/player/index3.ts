import { aligned, buffered_end, play_ahead } from "./media.ts"
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
  media_states,
  reduce,
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

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

export const decide = async (signal: AbortSignal): Promise<void> => {
  using lifetime = abortion(signal)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })

  const states = media_states(media, lifetime.signal)
  const initial = await states.next()
  if (initial.done) return
  let playback = initial_playback(page_position(), initial.value)

  const dispatch = (action: PlaybackAction): void => {
    const transition = reduce(playback, action)
    playback = transition.state
    const { persist, seek } = transition.effects
    if (persist !== undefined) persist_position(persist)
    if (seek !== undefined) media.currentTime = seek
  }
  const take_failure = (): MediaError | undefined => {
    const error = playback.failure
    dispatch({ kind: "consume_failure" })
    return error
  }
  const observe = (value: MediaState): void =>
    dispatch({ kind: "media", value })

  const read_state = async () =>
    ({ kind: "state", result: await states.next() }) as const
  let pending_state = read_state()
  const accept = (result: IteratorResult<MediaState>): boolean => {
    if (result.done) return false
    pending_state = read_state()
    observe(result.value)
    return true
  }
  const wait = async (until: () => boolean): Promise<boolean> => {
    for (;;) {
      if (!accept((await pending_state).result)) return false
      if (until()) return true
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
        if (!interrupted) interrupt()
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
    if (opened === STOP) return STOP

    const [source, create_buffer] = opened
    if (playback.current.duration > 0) {
      source.duration = playback.current.duration
    }
    const buffer = create_buffer(lifetime.signal)
    if ((await pull(buffer.next())) === STOP) return STOP

    const error = take_failure()
    if (error !== undefined) throw error
    return buffer
  }

  try {
    source: for (;;) {
      const media_failure = take_failure()
      if (media_failure !== undefined) console.error(media_failure)
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
        if (interrupted === STOP) return
        if (interrupted) take_failure()
        continue
      }
      if (buffer === STOP) return

      let accepted = playback.target
      let start = accepted.position
      const changed = (frontier: number): boolean =>
        playback.failure !== undefined ||
        (playback.target !== accepted &&
          playback.target.restart &&
          !aligned(playback.target.position, frontier))
      const retarget = (frontier: number): boolean => {
        const error = take_failure()
        if (error !== undefined) throw error
        if (playback.target === accepted) return false
        accepted = playback.target
        if (accepted.restart && !aligned(accepted.position, frontier)) {
          start = accepted.position
          return true
        }
        return false
      }

      request: for (;;) {
        let request_failure: { error: unknown } | undefined
        let frontier = stream_position(start)
        try {
          retarget(start)
          while (play_ahead(playback.current, start) >= BUFFER.LO) {
            const demanded = await wait(
              () =>
                changed(start) ||
                play_ahead(playback.current, start) < BUFFER.LO,
            )
            if (!demanded) return
            if (retarget(start)) continue request
          }

          using owner = abortion(lifetime.signal)
          const request = logical_stream(
            new Request(source_url(media, start), { signal: owner.signal }),
          )
          try {
            if ((await pull(buffer.next(frontier))) === STOP) return
            if (retarget(frontier)) continue request

            for (;;) {
              let read: Performed<IteratorResult<Uint8Array, undefined>>
              try {
                read = await perform(
                  request.next(),
                  () => changed(frontier),
                  owner[Symbol.dispose],
                )
              } catch (error) {
                request_failure = { error }
                break
              }
              if (read === STOP) return
              if (read.interrupted) continue request
              if (read.value.done) {
                if ((await pull(buffer.next(undefined))) === STOP) return
                if (!(await wait(() => changed(frontier)))) return
                continue request
              }

              if ((await pull(buffer.next(read.value.value))) === STOP) return
              frontier = stream_position(
                buffered_end(playback.current, frontier) ?? frontier,
              )
              if (retarget(frontier)) continue request
              if (play_ahead(playback.current, frontier) >= BUFFER.HI) {
                start = frontier
                continue request
              }
            }
          } finally {
            owner[Symbol.dispose]()
            await request.return(undefined)
          }
        } catch (error) {
          if ((await perform(Promise.resolve())) === STOP) return
          console.error(take_failure() ?? error)
          continue source
        }

        if (request_failure !== undefined) {
          console.error(request_failure.error)
          start = stream_position(
            buffered_end(playback.current, frontier) ?? frontier,
          )
          if ((await retry(() => changed(start))) === STOP) return
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

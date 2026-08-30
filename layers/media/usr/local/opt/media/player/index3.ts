import {
  aligned,
  buffered_end,
  buffered_position,
  media_states,
  play_ahead,
  type MediaState,
  type MediaTarget,
} from "./media.ts"
import { media_sources, type Mse } from "./mse.ts"
import {
  media,
  page_position,
  persist_position,
  run_playback,
  source_url,
  start_page,
} from "./page.ts"
import { abortion, delay, logical_stream } from "./util.ts"

const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000

const DONE = Symbol()
const STOP = Symbol()
const WAKE = Symbol()

type Performed<T> =
  | typeof STOP
  | Readonly<{
      interrupted: boolean
      result: PromiseSettledResult<T>
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
  let current = initial.value.current
  let target = { position: page_position(), restart: false }
  let pending_seek: { target: MediaTarget; acknowledged: boolean } | undefined =
    { target, acknowledged: false }
  let failure: MediaError | undefined

  const seek = (next: MediaTarget): void => {
    pending_seek = { target: next, acknowledged: false }
    media.currentTime = next.position
  }
  const take_failure = (): MediaError | undefined => {
    const error = failure
    failure = undefined
    return error
  }
  const observe = ({ current: latest, derived }: MediaState): void => {
    current = latest
    const { failure: media_failure, resume, seeks } = derived
    failure ??= media_failure
    let retargeted = false
    for (const { candidate, position, seeking } of seeks) {
      const owned_seek =
        pending_seek !== undefined &&
        aligned(position, pending_seek.target.position)
          ? pending_seek
          : undefined
      if (owned_seek) {
        owned_seek.acknowledged = true
      }
      if (seeking && owned_seek === undefined) {
        target = candidate
        retargeted = true
      }
    }

    const { metadata, seeking, time } = current
    if (retargeted) {
      pending_seek =
        target.restart || !aligned(time, target.position)
          ? { target, acknowledged: false }
          : undefined
      persist_position(target.position)
    }
    if (resume?.reason === "ended") {
      persist_position(resume.position)
    } else if (
      !retargeted &&
      pending_seek === undefined &&
      resume !== undefined
    ) {
      persist_position(resume.position)
    }
    if (pending_seek !== undefined) {
      const { target: seek_target } = pending_seek
      const playable = buffered_position(current, seek_target.position)
      seek_target.position = playable ?? seek_target.position
      if (!seeking) {
        const positioned = aligned(time, seek_target.position)
        if (!positioned && (metadata || playable !== undefined)) {
          seek(seek_target)
        } else if (positioned && pending_seek.acknowledged) {
          pending_seek = undefined
        }
      }
    }
  }

  type State = Readonly<{
    kind: "state"
    result: IteratorResult<MediaState>
  }>
  const read_state = async (): Promise<State> => ({
    kind: "state",
    result: await states.next(),
  })
  let pending_state = read_state()
  const accept = ({ result }: State): boolean => {
    if (result.done) return false
    pending_state = read_state()
    observe(result.value)
    return true
  }
  const wait = async (
    until: () => boolean,
  ): Promise<typeof STOP | typeof WAKE> => {
    for (;;) {
      if (!accept(await pending_state)) return STOP
      if (until()) return WAKE
    }
  }
  const perform = async <T>(
    promise: Promise<T>,
    until: () => boolean = () => false,
    interrupt: () => void = () => undefined,
  ): Promise<Performed<T>> => {
    const effect = promise.then(
      (value) =>
        ({
          kind: "effect",
          result: { status: "fulfilled", value },
        }) as const,
      (reason) =>
        ({
          kind: "effect",
          result: { status: "rejected", reason },
        }) as const,
    )
    let interrupted = false
    for (;;) {
      const selected = await Promise.race(
        interrupted ? [effect, pending_state] : [pending_state, effect],
      )
      if (selected.kind === "effect") {
        return { interrupted, result: selected.result }
      }
      if (!accept(selected)) {
        if (!interrupted) interrupt()
        await effect
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
    done: typeof DONE | typeof STOP = STOP,
    until: () => boolean = () => false,
    interrupt: () => void = () => undefined,
  ): Promise<T | typeof DONE | typeof STOP | typeof WAKE> => {
    const performed = await perform(promise, until, interrupt)
    if (performed === STOP) return STOP
    if (performed.interrupted) return WAKE
    if (performed.result.status === "rejected") throw performed.result.reason
    return performed.result.value.done ? done : performed.result.value.value
  }

  const report = (error: unknown): void => console.error(error)
  try {
    source: for (;;) {
      if (lifetime.signal.aborted) return
      const media_failure = take_failure()
      if (media_failure !== undefined) report(media_failure)
      const attempt = target
      let buffer: Mse | undefined
      let setup_failure: unknown | undefined
      let setup_failed = false
      try {
        const opening = sources.next()
        seek(target)
        const opened = await pull(opening)
        if (opened === STOP || opened === WAKE || opened === DONE) return
        const [source, create_buffer] = opened
        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        const created = create_buffer(lifetime.signal)
        buffer = created
        if ((await pull(created.next())) === STOP) return
        setup_failure = take_failure()
        setup_failed = setup_failure !== undefined
      } catch (error) {
        setup_failed = true
        setup_failure = error
      }
      if (setup_failed) {
        report(setup_failure)
        using timer = abortion(lifetime.signal)
        const retry = delay(timer.signal, RETRY_DELAY)
        const waited = await perform(
          retry,
          () => failure !== undefined || (target !== attempt && target.restart),
          timer[Symbol.dispose],
        )
        if (waited === STOP) return
        if (waited.result.status === "rejected") throw waited.result.reason
        if (waited.interrupted && !waited.result.value) {
          take_failure()
        }
        continue
      }
      if (buffer === undefined) return

      let accepted = target
      let start = accepted.position
      const changed = (frontier: number): boolean =>
        failure !== undefined ||
        (target !== accepted &&
          target.restart &&
          !aligned(target.position, frontier))
      const retarget = (frontier: number): boolean => {
        const error = take_failure()
        if (error !== undefined) throw error
        if (target === accepted) return false
        accepted = target
        if (accepted.restart && !aligned(accepted.position, frontier)) {
          start = accepted.position
          return true
        }
        return false
      }

      request: for (;;) {
        let source_failure: { error: unknown } | undefined
        let request_failure: unknown | undefined
        let frontier = stream_position(start)
        try {
          retarget(start)
          while (play_ahead(current, start) >= BUFFER.LO) {
            const demanded = await wait(
              () => changed(start) || play_ahead(current, start) < BUFFER.LO,
            )
            if (demanded === STOP) return
            if (retarget(start)) {
              continue request
            }
          }

          using owner = abortion(lifetime.signal)
          const request = logical_stream(
            new Request(source_url(media, start), { signal: owner.signal }),
          )
          try {
            if ((await pull(buffer.next(frontier))) === STOP) return
            if (retarget(frontier)) {
              continue request
            }

            for (;;) {
              let read: Uint8Array | typeof DONE | typeof STOP | typeof WAKE
              try {
                read = await pull(
                  request.next(),
                  DONE,
                  () => changed(frontier),
                  owner[Symbol.dispose],
                )
              } catch (error) {
                request_failure = error
                break
              }
              if (read === STOP) return
              if (read === WAKE) {
                continue request
              }
              if (read === DONE) {
                if ((await pull(buffer.next(undefined))) === STOP) return
                const wake = await wait(() => changed(frontier))
                if (wake === STOP) return
                continue request
              }

              if ((await pull(buffer.next(read))) === STOP) return
              frontier = stream_position(
                buffered_end(current, frontier) ?? frontier,
              )
              if (retarget(frontier)) {
                continue request
              }
              if (play_ahead(current, frontier) >= BUFFER.HI) {
                start = frontier
                continue request
              }
            }
          } finally {
            owner[Symbol.dispose]()
            await request.return(undefined)
          }
        } catch (error) {
          source_failure = { error }
        }

        if (source_failure !== undefined) {
          if ((await perform(Promise.resolve())) === STOP) return
          report(take_failure() ?? source_failure.error)
          continue source
        }

        if (request_failure !== undefined) {
          report(request_failure)
          start = stream_position(buffered_end(current, frontier) ?? frontier)
          using timer = abortion(lifetime.signal)
          const waited = await perform(
            delay(timer.signal, RETRY_DELAY),
            () => changed(start),
            timer[Symbol.dispose],
          )
          if (waited === STOP) return
          if (waited.result.status === "rejected") {
            throw waited.result.reason
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

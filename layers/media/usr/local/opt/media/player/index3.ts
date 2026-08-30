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

    const pending = pending_seek
    if (
      pending !== undefined &&
      seeks.some(({ position }) => aligned(position, pending.target.position))
    ) {
      pending.acknowledged = true
    }
    const external_seek = seeks.findLast(
      ({ position, seeking }) =>
        seeking &&
        (pending === undefined || !aligned(position, pending.target.position)),
    )
    const retargeted = external_seek !== undefined
    if (external_seek !== undefined) target = external_seek.candidate

    const { metadata, seeking, time } = current
    if (retargeted) {
      pending_seek =
        target.restart || !aligned(time, target.position)
          ? { target, acknowledged: false }
          : undefined
      persist_position(target.position)
    }
    if (
      resume !== undefined &&
      (resume.reason === "ended" ||
        (!retargeted && pending_seek === undefined))
    ) {
      persist_position(resume.position)
    }
    if (pending_seek === undefined || seeking) return

    const { target: seek_target } = pending_seek
    const playable = buffered_position(current, seek_target.position)
    seek_target.position = playable ?? seek_target.position
    const positioned = aligned(time, seek_target.position)
    if (!positioned && (metadata || playable !== undefined)) {
      seek(seek_target)
    } else if (positioned && pending_seek.acknowledged) {
      pending_seek = undefined
    }
  }

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
    seek(target)
    const opened = await pull(sources.next())
    if (opened === STOP) return STOP

    const [source, create_buffer] = opened
    if (current.duration > 0) {
      source.duration = current.duration
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
      const attempt = target
      let buffer: Mse | typeof STOP
      try {
        buffer = await open()
      } catch (error) {
        console.error(error)
        const interrupted = await retry(
          () => failure !== undefined || (target !== attempt && target.restart),
        )
        if (interrupted === STOP) return
        if (interrupted) {
          take_failure()
        }
        continue
      }
      if (buffer === STOP) return

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
        let request_failure: unknown | undefined
        let frontier = stream_position(start)
        try {
          retarget(start)
          while (play_ahead(current, start) >= BUFFER.LO) {
            if (
              !(await wait(
                () => changed(start) || play_ahead(current, start) < BUFFER.LO,
              ))
            ) {
              return
            }
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
              let read: Performed<
                IteratorResult<Uint8Array<ArrayBuffer>, undefined>
              >
              try {
                read = await perform(
                  request.next(),
                  () => changed(frontier),
                  owner[Symbol.dispose],
                )
              } catch (error) {
                request_failure = error
                break
              }
              if (read === STOP) return
              if (read.interrupted) {
                continue request
              }
              if (read.value.done) {
                if ((await pull(buffer.next(undefined))) === STOP) return
                if (!(await wait(() => changed(frontier)))) return
                continue request
              }

              if ((await pull(buffer.next(read.value.value))) === STOP) return
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
          if ((await perform(Promise.resolve())) === STOP) return
          console.error(take_failure() ?? error)
          continue source
        }

        if (request_failure !== undefined) {
          console.error(request_failure)
          start = stream_position(buffered_end(current, frontier) ?? frontier)
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

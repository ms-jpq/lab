import {
  aligned,
  buffered_end,
  buffered_position,
  media_states,
  play_ahead,
  playable_position,
  type MediaState,
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
import { abortion, delay, interleave, logical_stream } from "./util.ts"

const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000
const DONE = Symbol()
const REPORT = Symbol()
const STOP = Symbol()
const WAKE = Symbol()
type Choice<T> = T | typeof STOP | typeof WAKE
type ReportFailure = { [REPORT]: unknown }
type MediaTarget = { position: number; restart: boolean }

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const decide = async (signal: AbortSignal): Promise<void> => {
  using lifetime = abortion(signal)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })
  const states = media_states(media, lifetime.signal)
  const next_state = interleave(states)
  let current = states.read()
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
    const { ended, failure: media_failure, moved, seeks } = derived
    failure ??= media_failure
    let retargeted = false
    for (const [snapshot] of seeks) {
      const { seeking, time } = snapshot
      const owned_seek =
        pending_seek !== undefined &&
        aligned(time, pending_seek.target.position)
          ? pending_seek
          : undefined
      if (owned_seek) {
        owned_seek.acknowledged = true
      }
      if (seeking && owned_seek === undefined) {
        const native = playable_position(media, time)
        const playable = buffered_position(snapshot, native)
        target = {
          position: playable ?? native,
          restart: playable === undefined,
        }
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
    if (ended) {
      persist_position(0)
    } else if (
      !retargeted &&
      pending_seek === undefined &&
      moved &&
      buffered_position(current, time) === time
    ) {
      persist_position(time)
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

  const wait = async <T>(
    work?: Promise<T>,
    until: () => boolean = () => false,
  ): Promise<Choice<T>> => {
    for (;;) {
      const selected = await next_state(work)
      if (selected.kind === "source") {
        if (selected.result.done) {
          return STOP
        }
        observe(selected.result.value)
        if (until()) {
          return WAKE
        }
        continue
      }
      current = states.read()
      if (selected.result.status === "rejected") {
        throw selected.result.reason
      }
      return selected.result.value
    }
  }
  const pull = async <T, R>(
    work: Promise<IteratorResult<T, R>>,
    done: typeof DONE | typeof STOP = STOP,
    until: () => boolean = () => false,
  ): Promise<T | typeof DONE | typeof STOP | typeof WAKE> => {
    const choice = await wait(work, until)
    return choice === STOP || choice === WAKE
      ? choice
      : choice.done
        ? done
        : choice.value
  }
  const handoff = async <T>(
    work: Promise<T>,
    until: () => boolean,
  ): Promise<Choice<T>> => {
    const choice = await wait(work, until)
    if (choice === STOP || choice === WAKE) return choice
    return (await wait(Promise.resolve())) === STOP ? STOP : choice
  }

  const report = (error: unknown): void => {
    try {
      console.error(error)
    } catch (failure) {
      throw { [REPORT]: failure } satisfies ReportFailure
    }
  }
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
        const waited = await handoff(
          delay(timer.signal, RETRY_DELAY),
          () => failure !== undefined || (target !== attempt && target.restart),
        )
        if (waited === STOP) return
        if (waited === WAKE) {
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

      try {
        request: for (;;) {
          retarget(start)
          while (play_ahead(current, start) >= BUFFER.LO) {
            const demanded = await wait(
              undefined,
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
          let frontier = stream_position(start)
          let request_failure: unknown | undefined
          try {
            if ((await pull(buffer.next(frontier))) === STOP) return
            if (retarget(frontier)) {
              continue request
            }

            for (;;) {
              let read: Uint8Array | typeof DONE | typeof STOP | typeof WAKE
              try {
                read = await pull(request.next(), DONE, () => changed(frontier))
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
                const wake = await wait(undefined, () => changed(frontier))
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

          if (request_failure !== undefined) {
            report(request_failure)
            start = stream_position(buffered_end(current, frontier) ?? frontier)
            using timer = abortion(lifetime.signal)
            const waited = await handoff(delay(timer.signal, RETRY_DELAY), () =>
              changed(start),
            )
            if (waited === STOP) return
          }
        }
      } catch (error) {
        if (typeof error === "object" && error !== null && REPORT in error) {
          throw error
        }
        if ((await handoff(Promise.resolve(), () => false)) === STOP) return
        report(take_failure() ?? error)
        continue source
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

const play_media = async (signal: AbortSignal): Promise<void> => {
  try {
    await decide(signal)
  } catch (error) {
    if (typeof error === "object" && error !== null && REPORT in error) {
      throw (error as ReportFailure)[REPORT]
    }
    throw error
  }
}

export const playback_page = async (signal: AbortSignal): Promise<void> => {
  await run_playback(signal, play_media)
}

export const PULSE = Symbol()
export const page_reader = undefined
export const play_source = undefined
export const request_stream = undefined

void start_page(playback_page).catch(console.error)

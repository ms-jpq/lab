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
import { abortion, delay, logical_stream } from "./util.ts"

type Effect = () => unknown | PromiseLike<unknown>
const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000
const CHANGE = Symbol()
const DONE = Symbol()
const REPORT = Symbol()
const STOP = Symbol()
type Choice<T> = T | typeof CHANGE | typeof STOP
type ReportFailure = { [REPORT]: unknown }
type MediaTarget = { position: number; restart: boolean }

const resume = <T>(value: unknown): T => value as T

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const decide = async function* (
  signal: AbortSignal,
): AsyncGenerator<Effect, void, unknown> {
  using lifetime = abortion(signal)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })
  const states = media_states(media, lifetime.signal)
  let observed: Promise<IteratorResult<MediaState, unknown>> | undefined
  let ready: IteratorResult<MediaState, unknown> | undefined
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
  const observe = ({ current: latest, observations }: MediaState): void => {
    current = latest
    if (observations.length === 0) return

    let ended = false
    let moved = false
    let retargeted = false
    for (const [snapshot, event] of observations) {
      const { error, seeking, time } = snapshot
      const seek_event = event.type === "seeking" || event.type === "seeked"
      ended ||= event.type === "ended"
      moved ||= event.type === "timeupdate" || seek_event
      if (
        event.type === "error" &&
        error !== undefined &&
        error.code !== MediaError.MEDIA_ERR_ABORTED
      ) {
        failure ??= error
      }
      const owned_seek =
        pending_seek !== undefined &&
        aligned(time, pending_seek.target.position)
          ? pending_seek
          : undefined
      if (seek_event && owned_seek) {
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

  const select =
    <T>(
      work?: Promise<T>,
      interrupted: () => boolean = () => false,
    ): (() => Promise<Choice<T>>) =>
    async (): Promise<Choice<T>> => {
      for (;;) {
        const observation = (observed ??= states.next().then((value) => {
          ready = value
          return value
        }))
        let selected: T | undefined
        let worked = false
        if (ready === undefined && work !== undefined) {
          const winner = await Promise.race([
            observation,
            work.then(
              (value) => {
                current = states.read()
                return { value }
              },
              (error) => {
                current = states.read()
                throw error
              },
            ),
          ])
          if ("value" in winner) {
            selected = winner.value as T
            worked = true
          }
        } else if (ready === undefined) {
          await observation
        }
        if (ready !== undefined) {
          const next = ready
          ready = undefined
          observed = undefined
          if (next.done) {
            return STOP
          }
          observe(next.value)
          if (interrupted()) {
            return CHANGE
          }
          continue
        }
        if (worked) {
          return selected as T
        }
      }
    }
  const pull =
    <T, R>(
      work: Promise<IteratorResult<T, R>>,
      done: typeof DONE | typeof STOP = STOP,
      interrupted: () => boolean = () => false,
    ): (() => Promise<T | typeof CHANGE | typeof DONE | typeof STOP>) =>
    async (): Promise<T | typeof CHANGE | typeof DONE | typeof STOP> => {
      const choice = await select(work, interrupted)()
      return choice === STOP || choice === CHANGE
        ? choice
        : choice.done
          ? done
          : choice.value
    }

  const report =
    (error: unknown): Effect =>
    () => {
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
      if (media_failure !== undefined) yield report(media_failure)
      const attempt = target
      let buffer: Mse | undefined
      let setup_failure: unknown | undefined
      let setup_failed = false
      try {
        const { opening } = resume<{
          opening: ReturnType<typeof sources.next>
        }>(
          yield () => {
            const opening = sources.next()
            seek(target)
            return { opening }
          },
        )
        const opened = resume<
          [MediaSource, (_: AbortSignal) => Mse] | typeof CHANGE | typeof STOP
        >(yield pull(opening))
        if (opened === STOP || opened === CHANGE) return
        const [source, create_buffer] = opened
        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        buffer = create_buffer(lifetime.signal)
        if (resume(yield pull(buffer.next())) === STOP) return
        setup_failure = take_failure()
        setup_failed = setup_failure !== undefined
      } catch (error) {
        setup_failed = true
        setup_failure = error
      }
      if (setup_failed) {
        yield report(setup_failure)
        using timer = abortion(lifetime.signal)
        const waited = resume<Choice<boolean>>(
          yield select(
            delay(timer.signal, RETRY_DELAY),
            () =>
              failure !== undefined ||
              (target !== attempt && target.restart),
          ),
        )
        if (waited === STOP) return
        if (waited === CHANGE) {
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
            const demanded = resume<Choice<never>>(
              yield select(
                undefined,
                () => changed(start) || play_ahead(current, start) < BUFFER.LO,
              ),
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
            if (resume(yield pull(buffer.next(frontier))) === STOP) return
            if (retarget(frontier)) {
              continue request
            }

            for (;;) {
              let read: Uint8Array | typeof CHANGE | typeof DONE | typeof STOP
              try {
                read = resume(
                  yield pull(request.next(), DONE, () => changed(frontier)),
                )
              } catch (error) {
                request_failure = error
                break
              }
              if (read === STOP) return
              if (read === CHANGE) {
                continue request
              }
              if (read === DONE) {
                if (resume(yield pull(buffer.next(undefined))) === STOP) return
                const wake = resume<Choice<never>>(
                  yield select(undefined, () => changed(frontier)),
                )
                if (wake === STOP) return
                continue request
              }

              if (resume(yield pull(buffer.next(read))) === STOP) return
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
            yield report(request_failure)
            start = stream_position(
              buffered_end(current, frontier) ?? frontier,
            )
            using timer = abortion(lifetime.signal)
            const waited = resume<Choice<boolean>>(
              yield select(delay(timer.signal, RETRY_DELAY), () =>
                changed(start),
              ),
            )
            if (waited === STOP) return
          }
        }
      } catch (error) {
        yield select(Promise.resolve())
        yield report(take_failure() ?? error)
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

const perform = async function* (
  program: AsyncGenerator<Effect, void, unknown>,
): AsyncIteratorObject<void> {
  let step = await program.next()
  try {
    while (!step.done) {
      try {
        step = await program.next(await step.value())
      } catch (error) {
        if (typeof error === "object" && error !== null && REPORT in error) {
          throw (error as ReportFailure)[REPORT]
        }
        step = await program.throw(error)
      }
      if (!step.done) yield
    }
  } finally {
    await program.return(undefined)
  }
  return
}

const play_media = async (signal: AbortSignal): Promise<void> => {
  for await (const _ of perform(decide(signal))) {
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

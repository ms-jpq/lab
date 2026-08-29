import {
  aligned,
  buffered_end,
  buffered_position,
  media_events,
  media_snapshot,
  play_ahead,
  playable_position,
  type MediaObservation,
} from "./media.ts"
import { media_sources, type Mse } from "./mse.ts"
import {
  form,
  initial_position,
  media,
  page_position,
  persist_position,
  run_page,
  source_url,
  submit,
  subtitle,
} from "./page.ts"
import { abortion, delay, logical_stream, once } from "./util.ts"

type Effect = () => unknown | PromiseLike<unknown>
type Target = { position: number; restart: boolean; started: boolean }

const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000
const CHANGE = Symbol()
const DONE = Symbol()
const STOP = Symbol()
type Choice<T> = T | typeof CHANGE | typeof STOP

const resume = <T>(value: unknown): T => value as T

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const decide = async function* (
  signal: AbortSignal,
): AsyncGenerator<Effect, void, unknown> {
  using lifetime = abortion(signal)
  const observations = media_events(media, lifetime.signal)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal: lifetime.signal,
  })
  let observed: Promise<IteratorResult<MediaObservation[]>> | undefined
  let ready: IteratorResult<MediaObservation[]> | undefined
  let current = media_snapshot(media)
  let previous = current
  let target = {
    position: page_position(),
    restart: false,
    started: false,
  }
  let handled = target
  let positioning: Target | undefined = target
  let failure: unknown | undefined

  const apply = (batch: MediaObservation[]): void => {
    for (const [snapshot, event] of batch) {
      current = snapshot
      if (
        event.type === "error" &&
        current.error !== null &&
        current.error.code !== MediaError.MEDIA_ERR_ABORTED
      ) {
        failure ??= current.error
      }
      const owned =
        positioning !== undefined && aligned(current.time, positioning.position)
          ? positioning
          : undefined
      if ((event.type === "seeking" || event.type === "seeked") && owned) {
        owned.started = true
      }
      if (current.seeking && owned === undefined) {
        const native = playable_position(media, current.time)
        target = {
          position: buffered_position(media, native) ?? native,
          restart: buffered_position(media, native) === undefined,
          started: true,
        }
      }
    }

    const moved =
      current.time !== previous.time || current.seeking !== previous.seeking
    const changed = target !== handled
    if (changed) {
      positioning =
        target.restart || !aligned(current.time, target.position)
          ? target
          : undefined
      handled = target
      persist_position(target.position)
    }
    if (current.ended && !previous.ended) {
      persist_position(0)
    } else if (
      !changed &&
      positioning === undefined &&
      moved &&
      buffered_position(media, current.time) === current.time
    ) {
      persist_position(current.time)
    }
    if (positioning !== undefined) {
      const playable = buffered_position(media, positioning.position)
      positioning.position = playable ?? positioning.position
      if (!current.seeking) {
        const positioned = aligned(current.time, positioning.position)
        if (!positioned && (current.metadata || playable !== undefined)) {
          positioning.started = false
          media.currentTime = positioning.position
        } else if (positioned && positioning.started) {
          positioning = undefined
        }
      }
    }
    previous = current
  }

  const select = <T>(
    work?: Promise<T>,
    interrupted: () => boolean = () => false,
  ): (() => Promise<Choice<T>>) => async (): Promise<Choice<T>> => {
    for (;;) {
      observed ??= observations.next().then((value) => {
        ready = value
        return value
      })
      let selected: T | undefined
      let worked = false
      if (ready === undefined && work !== undefined) {
        const winner = await Promise.race([
          observed,
          work.then((value) => ({ value })),
        ])
        if ("value" in winner) {
          selected = winner.value
          worked = true
        }
      } else if (ready === undefined) {
        await observed
      }
      if (ready !== undefined) {
        const next = ready
        ready = undefined
        observed = undefined
        if (next.done) {
          return STOP
        }
        apply(next.value)
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
  const pull = <T, R>(
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

  const report = (error: unknown): Effect => () => console.error(error)
  const take_failure = (): unknown => {
    const error = failure
    failure = undefined
    return error
  }

  try {
    source: for (;;) {
      if (lifetime.signal.aborted) {
        return
      }
      const attempt = target
      let buffer: Mse | undefined
      let setup_failure: unknown | undefined
      let setup_failed = false
      try {
        positioning = target
        target.started = false
        const opening = sources.next()
        yield () => {
          media.currentTime = target.position
        }
        const opened = resume<
          [MediaSource, (_: AbortSignal) => Mse] | typeof CHANGE | typeof STOP
        >(yield pull(opening))
        if (opened === STOP || opened === CHANGE) {
          return
        }
        const [source, create_buffer] = opened
        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        buffer = create_buffer(lifetime.signal)
        if (resume(yield pull(buffer.next())) === STOP) {
          return
        }
        setup_failure = take_failure()
        setup_failed = setup_failure !== undefined
      } catch (error) {
        setup_failed = true
        setup_failure = error
      }
      if (setup_failed) {
        yield report(setup_failure)
        using timer = abortion(lifetime.signal)
        const waited = resume<Choice<boolean>>(yield select(
          delay(timer.signal, RETRY_DELAY),
          () =>
            failure !== undefined ||
            (target !== attempt && target.restart),
        ))
        if (waited === STOP) {
          return
        }
        if (waited === CHANGE) {
          take_failure()
        }
        continue
      }
      if (buffer === undefined) {
        return
      }

      let accepted = target
      let start = accepted.position
      const changed = (frontier: number): boolean =>
        failure !== undefined ||
        (target !== accepted &&
          target.restart &&
          !aligned(target.position, frontier))
      const retarget = (frontier: number): boolean => {
        const error = take_failure()
        if (error !== undefined) {
          throw error
        }
        if (target === accepted) {
          return false
        }
        accepted = target
        if (target.restart && !aligned(target.position, frontier)) {
          start = target.position
          return true
        }
        return false
      }

      try {
        request: for (;;) {
          retarget(start)
          while (play_ahead(media, start) >= BUFFER.LO) {
            const demanded = resume<Choice<never>>(yield select(undefined, () =>
              changed(start) || play_ahead(media, start) < BUFFER.LO,
            ))
            if (demanded === STOP) {
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
          let frontier = stream_position(start)
          let request_failure: unknown | undefined
          try {
            if (resume(yield pull(buffer.next(frontier))) === STOP) {
              return
            }
            if (retarget(frontier)) {
              continue request
            }

            for (;;) {
              let read:
                | Uint8Array
                | typeof CHANGE
                | typeof DONE
                | typeof STOP
              try {
                read = resume(
                  yield pull(request.next(), DONE, () => changed(frontier)),
                )
              } catch (error) {
                request_failure = error
                break
              }
              if (read === STOP) {
                return
              }
              if (read === CHANGE) {
                continue request
              }
              if (read === DONE) {
                if (resume(yield pull(buffer.next(undefined))) === STOP) {
                  return
                }
                const wake = resume<Choice<never>>(yield select(undefined, () =>
                  changed(frontier),
                ))
                if (wake === STOP) {
                  return
                }
                continue request
              }

              if (resume(yield pull(buffer.next(read))) === STOP) {
                return
              }
              frontier = stream_position(
                buffered_end(media, frontier) ?? frontier,
              )
              if (retarget(frontier)) {
                continue request
              }
              if (play_ahead(media, frontier) >= BUFFER.HI) {
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
            start = stream_position(buffered_end(media, frontier) ?? frontier)
            using timer = abortion(lifetime.signal)
            const waited = resume<Choice<boolean>>(yield select(
              delay(timer.signal, RETRY_DELAY),
              () => changed(start),
            ))
            if (waited === STOP) {
              return
            }
          }
        }
      } catch (error) {
        yield report(error)
        continue source
      }
    }
  } finally {
    lifetime[Symbol.dispose]()
    try {
      await sources.return?.()
    } finally {
      await observations.return?.()
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
        step = await program.throw(error)
      }
      if (!step.done) {
        yield
      }
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

export const play_subtitle = async (signal: AbortSignal): Promise<void> => {
  if (!subtitle || signal.aborted) {
    return
  }
  for (;;) {
    let event: Event | undefined
    {
      using attempt = abortion(signal)
      const loaded = Promise.race([
        once(attempt.signal, subtitle, "load"),
        once(attempt.signal, subtitle, "error"),
      ])
      subtitle.src = source_url(subtitle, 0)
      event = await loaded
    }
    if (event === undefined || event.type === "load") {
      return
    }
    console.error(event)
    if (!(await delay(signal, RETRY_DELAY)) || signal.aborted) {
      return
    }
  }
}

export const playback_page = async (signal: AbortSignal): Promise<void> => {
  using lifetime = abortion(signal)
  const playback = play_media(lifetime.signal)
  const captions = play_subtitle(lifetime.signal).then(() => playback)
  try {
    await Promise.race([playback, captions])
  } finally {
    lifetime[Symbol.dispose]()
    await Promise.allSettled([playback, captions])
  }
}

export const PULSE = Symbol()
export const page_reader = undefined
export const play_source = undefined
export const request_stream = undefined

const main = async (): Promise<void> => {
  form.onsubmit = submit
  persist_position(initial_position)
  await run_page(playback_page)
}

void main().catch(console.error)

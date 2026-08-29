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
type Choice<T> =
  | { kind: "change" }
  | { kind: "stop" }
  | { kind: "work"; value: T }

const BUFFER = { BEHIND: 30, LO: 45, HI: 60 }
const RETRY_DELAY = 1_000

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
  ): Effect => async (): Promise<Choice<T>> => {
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
          return { kind: "stop" }
        }
        apply(next.value)
        if (interrupted()) {
          return { kind: "change" }
        }
        continue
      }
      if (worked) {
        return { kind: "work", value: selected as T }
      }
    }
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
      try {
        positioning = target
        target.started = false
        yield () => {
          media.currentTime = target.position
        }
        const opened = (yield select(sources.next())) as Choice<
          IteratorResult<[MediaSource, (_: AbortSignal) => Mse]>
        >
        if (opened.kind !== "work" || opened.value.done) {
          return
        }
        const [source, create_buffer] = opened.value.value
        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        buffer = create_buffer(lifetime.signal)
        const primed = (yield select(buffer.next())) as Choice<
          IteratorResult<void>
        >
        if (primed.kind !== "work" || primed.value.done) {
          return
        }
        setup_failure = take_failure()
      } catch (error) {
        setup_failure = error
      }
      if (setup_failure !== undefined) {
        yield report(setup_failure)
        using timer = abortion(lifetime.signal)
        const waited = (yield select(
          delay(timer.signal, RETRY_DELAY),
          () =>
            failure !== undefined ||
            (target !== attempt && target.restart),
        )) as Choice<boolean>
        if (waited.kind === "stop") {
          return
        }
        if (waited.kind === "change") {
          take_failure()
        }
        continue
      }
      if (buffer === undefined) {
        return
      }

      let accepted = target
      let start = accepted.position
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
            const demanded = (yield select(undefined, () =>
              retarget(start) || play_ahead(media, start) < BUFFER.LO,
            )) as Choice<never>
            if (demanded.kind === "stop") {
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
            const positioned = (yield select(buffer.next(frontier))) as Choice<
              IteratorResult<void>
            >
            if (positioned.kind !== "work" || positioned.value.done) {
              return
            }
            if (retarget(frontier)) {
              continue request
            }

            for (;;) {
              let read: Choice<IteratorResult<Uint8Array>>
              try {
                read = (yield select(request.next(), () =>
                  retarget(frontier),
                )) as Choice<IteratorResult<Uint8Array>>
              } catch (error) {
                request_failure = error
                break
              }
              if (read.kind === "stop") {
                return
              }
              if (read.kind === "change") {
                continue request
              }
              if (read.value.done) {
                const ended = (yield select(
                  buffer.next(undefined),
                )) as Choice<IteratorResult<void>>
                if (ended.kind !== "work" || ended.value.done) {
                  return
                }
                const changed = (yield select(undefined, () =>
                  retarget(frontier),
                )) as Choice<never>
                if (changed.kind === "stop") {
                  return
                }
                continue request
              }

              const appended = (yield select(
                buffer.next(read.value.value),
              )) as Choice<IteratorResult<void>>
              if (appended.kind !== "work" || appended.value.done) {
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
            const waited = (yield select(
              delay(timer.signal, RETRY_DELAY),
              () => retarget(start),
            )) as Choice<boolean>
            if (waited.kind === "stop") {
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

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
import { media_sources, type Mse, type MseOperation } from "./mse.ts"
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
import { abortion, delay, first, logical_stream } from "./util.ts"

type Failure = { failure: unknown }
type Result<T> = Failure | { value: T }
type OwnedStream<T, R> = {
  next: () => Promise<IteratorResult<T, R>>
  return: () => Promise<IteratorResult<T, R>>
}
type RequestStream = OwnedStream<Uint8Array, { error: unknown } | void>
type Reporter = (error: unknown) => void
type Target = { position: number; restart: boolean; started: boolean }

type PageReader = {
  next: <T>(work?: Promise<T>) => Promise<typeof PULSE | T | undefined>
  return: () => Promise<IteratorResult<typeof PULSE, void>>
  seek: () => void
  take_error: () => unknown
  readonly target: Target
}
type Effect =
  | { kind: "mutate"; operation: MseOperation }
  | { error: unknown; kind: "report" }
type AttemptFailure = Failure & { opened: boolean }

const PULSE = Symbol()
const WAIT = Symbol()
const BUFFER = {
  BEHIND: 30,
  LO: 45,
  HI: 60,
}
const RETRY_DELAY = 1_000

const result = <T>(promise: Promise<T>): Promise<Result<T>> =>
  promise.then(
    (value) => ({ value }),
    (failure) => ({ failure }),
  )

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const page_reader = (signal: AbortSignal, position: number): PageReader => {
  const lifetime = abortion(signal)
  const observations = media_events(media, lifetime.signal)
  let target = { position, restart: false, started: false }
  let positioning: Target | undefined = target
  let failure: unknown | undefined = undefined
  let current = media_snapshot(media)
  let previous = current
  let handled = target
  let changed = true
  let closed = false
  let wake = Promise.withResolvers<void>()
  let stream_error: unknown | undefined = undefined

  const seek = (): void => {
    target.started = false
    positioning = target
    media.currentTime = target.position
  }
  const take_error = (): unknown => {
    const error = failure
    failure = undefined
    return error
  }
  const observe = ([snapshot, event]: MediaObservation): void => {
    current = snapshot
    const { error } = current
    if (
      event.type === "error" &&
      error !== null &&
      error.code !== MediaError.MEDIA_ERR_ABORTED
    ) {
      failure ??= error
    }
    const owned =
      positioning !== undefined && aligned(current.time, positioning.position)
        ? positioning
        : undefined
    if ((event.type === "seeking" || event.type === "seeked") && owned) {
      owned.started = true
    }
    if (current.seeking && !owned) {
      const native = playable_position(media, current.time)
      target = {
        position: buffered_position(media, native) ?? native,
        restart: false,
        started: true,
      }
    }
  }
  const apply = (batch: MediaObservation[]): void => {
    for (const observation of batch) {
      observe(observation)
    }

    const moved =
      current.time !== previous.time || current.seeking !== previous.seeking
    const user_seek = target !== handled

    if (user_seek) {
      const playable = buffered_position(media, target.position)
      target.position = playable ?? target.position
      target.restart = playable === undefined
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
      !user_seek &&
      positioning === undefined &&
      moved &&
      buffered_position(media, current.time) === current.time
    ) {
      persist_position(current.time)
    }

    if (positioning !== undefined) {
      const playable = buffered_position(media, positioning.position)
      if (playable !== undefined) {
        positioning.position = playable
      }
      if (!current.seeking) {
        const positioned = aligned(current.time, positioning.position)
        if (!positioned && (current.metadata || playable !== undefined)) {
          seek()
        } else if (positioned && positioning.started) {
          positioning = undefined
        }
      }
    }

    previous = current
  }

  const running = (async (): Promise<void> => {
    try {
      for await (const batch of observations) {
        apply(batch)
        changed = true
        wake.resolve()
      }
    } catch (error) {
      stream_error = error
    } finally {
      closed = true
      wake.resolve()
    }
  })()

  const pulse = (): typeof PULSE => {
    changed = false
    wake = Promise.withResolvers<void>()
    return PULSE
  }
  const end = (): undefined => {
    if (stream_error !== undefined) {
      throw stream_error
    }
    return undefined
  }

  return {
    next: async <T>(
      work?: Promise<T>,
    ): Promise<typeof PULSE | T | undefined> => {
      if (changed) {
        return pulse()
      }
      if (closed) {
        return end()
      }

      const selected = await Promise.race([
        wake.promise,
        ...(work === undefined ? [] : [work]),
      ])
      if (changed) {
        return pulse()
      }
      if (closed) {
        return end()
      }
      return selected as T
    },
    return: async (): Promise<IteratorResult<typeof PULSE, void>> => {
      lifetime[Symbol.dispose]()
      await running
      return { done: true, value: undefined }
    },
    seek,
    take_error,
    get target(): Target {
      return target
    },
  }
}

const request_stream = (time: number): RequestStream => {
  const lifetime = abortion()
  const stream = logical_stream(
    new Request(source_url(media, time), { signal: lifetime.signal }),
  )
  let active = true

  const finish = async (
    value?: { error: unknown },
  ): Promise<IteratorResult<Uint8Array, { error: unknown } | void>> => {
    if (!active) {
      return { done: true, value }
    }
    active = false
    try {
      await stream.return(undefined)
    } finally {
      lifetime[Symbol.dispose]()
    }
    return { done: true, value }
  }

  return {
    next: async (): Promise<
      IteratorResult<Uint8Array, { error: unknown } | void>
    > => {
      if (!active) {
        return { done: true, value: undefined }
      }
      try {
        const next = await stream.next()
        return next.done ? await finish() : next
      } catch (error) {
        return await finish(lifetime.signal.aborted ? undefined : { error })
      }
    },
    return: () => {
      lifetime[Symbol.dispose]()
      return finish()
    },
  }
}

const wait_until = async <T, R>(
  page: PageReader,
  work: Promise<T> | undefined,
  decide: (change: typeof PULSE | T | undefined) => R | typeof WAIT,
): Promise<R> => {
  for (;;) {
    const decision = decide(await page.next(work))
    if (decision !== WAIT) {
      return decision as R
    }
  }
}

const retry_when = async (
  page: PageReader,
  interrupted: () => boolean,
): Promise<boolean> => {
  using timer = abortion()
  return await wait_until(page, delay(timer.signal, RETRY_DELAY), (change) =>
    change === PULSE && !interrupted() ? WAIT : change !== undefined,
  )
}

const wait_for_demand = (
  page: PageReader,
  start: number,
  retarget: (frontier: number) => boolean,
): Promise<"ready" | "restart" | undefined> =>
  play_ahead(media, start) < BUFFER.LO
    ? Promise.resolve("ready")
    : wait_until(page, undefined, (change) => {
        if (change === undefined) {
          return undefined
        }
        if (retarget(start)) {
          return "restart"
        }
        return play_ahead(media, start) < BUFFER.LO ? "ready" : WAIT
      })

const decide = async function* (
  page: PageReader,
): AsyncGenerator<Effect, void, void> {
  let target = page.target
  let start = target.position

  const retarget = (frontier: number): boolean => {
    const error = page.take_error()
    if (error !== undefined) {
      throw error
    }
    if (page.target === target) {
      return false
    }
    target = page.target
    if (
      buffered_position(media, target.position) === undefined &&
      !aligned(target.position, frontier)
    ) {
      start = target.position
      return true
    }
    return false
  }

  source: for (;;) {
    retarget(start)
    const demanded = await wait_for_demand(page, start, retarget)
    if (demanded === undefined) {
      return
    }
    if (demanded === "restart") {
      continue
    }

    const request = request_stream(start)
    let frontier = stream_position(start)
    try {
      yield { kind: "mutate", operation: frontier }
      if (retarget(frontier)) {
        continue
      }

      for (;;) {
        const change = await wait_until(page, request.next(), (selected) =>
          selected !== PULSE || retarget(frontier) ? selected : WAIT,
        )
        if (change === undefined) {
          return
        }
        if (change === PULSE) {
          continue source
        }
        if (change.done) {
          if (change.value === undefined) {
            yield { kind: "mutate", operation: undefined }
            const action = await wait_until(
              page,
              undefined,
              (selected): "done" | "restart" | typeof WAIT => {
                if (selected === undefined) {
                  return "done"
                }
                return retarget(frontier) ? "restart" : WAIT
              },
            )
            if (action === "done") {
              return
            }
            continue source
          }

          yield { error: change.value.error, kind: "report" }
          start = stream_position(buffered_end(media, frontier) ?? frontier)
          break
        }

        yield { kind: "mutate", operation: change.value }
        frontier = stream_position(buffered_end(media, frontier) ?? frontier)
        if (retarget(frontier)) {
          continue source
        }
        if (play_ahead(media, frontier) >= BUFFER.HI) {
          start = frontier
          continue source
        }
      }
    } finally {
      await request.return()
    }

    if (
      !(await retry_when(page, () => {
        const interrupted = page.target !== target && page.target.restart
        if (retarget(start) || interrupted) {
          start = page.target.position
          return true
        }
        return false
      }))
    ) {
      return
    }
  }
}

const perform = async function* (
  buffer: Mse,
  report: Reporter,
  effects: AsyncGenerator<Effect, void, void>,
): AsyncGenerator<void, Failure | void, void> {
  try {
    for (;;) {
      const selected = await result(effects.next())
      if ("failure" in selected) {
        return selected
      }
      if (selected.value.done) {
        return
      }

      const effect = selected.value.value
      if (effect.kind === "report") {
        report(effect.error)
        yield
        continue
      }

      const mutated = await result(buffer.next(effect.operation))
      if ("failure" in mutated) {
        return mutated
      }
      if (mutated.value.done) {
        return
      }
      yield
    }
  } finally {
    await effects.return(undefined)
  }
}

const play_source = async (
  buffer: Mse,
  report: Reporter,
  page: PageReader,
): Promise<Failure | void> => {
  const running = perform(buffer, report, decide(page))
  for (;;) {
    const next = await running.next()
    if (next.done) {
      return next.value
    }
  }
}

const play_attempt = async (
  signal: AbortSignal,
  sources: ReturnType<typeof media_sources>,
  report: Reporter,
  page: PageReader,
): Promise<AttemptFailure | undefined> => {
  let buffer: Mse | undefined
  try {
    const opening = sources.next()
    page.seek()
    const next = await opening
    if (next.done || signal.aborted) {
      return undefined
    }

    const [source, create_buffer] = next.value
    const duration = Number(media.dataset["duration"])
    if (duration > 0) {
      source.duration = duration
    }
    const created = create_buffer(signal)
    buffer = (await created.next()).done ? undefined : created
  } catch (failure) {
    return signal.aborted
      ? undefined
      : { failure, opened: false }
  }
  if (buffer === undefined) {
    return undefined
  }

  const played = await play_source(buffer, report, page)
  return played === undefined || signal.aborted
    ? undefined
    : {
        failure: page.take_error() ?? played.failure,
        opened: true,
      }
}

const play_media = async (signal: AbortSignal): Promise<void> => {
  const page = page_reader(signal, page_position())
  const report: Reporter = (error) => console.error(error)
  const sources = media_sources({
    evict_behind: BUFFER.BEHIND,
    media,
    mime_type: media.dataset["mseType"] as string,
    signal,
  })
  try {
    for (;;) {
      if (signal.aborted) {
        return
      }
      const page_failure = page.take_error()
      if (page_failure !== undefined) {
        report(page_failure)
      }
      const target = page.target
      const attempt = await play_attempt(signal, sources, report, page)
      if (attempt === undefined) {
        return
      }
      report(attempt.failure)
      if (
        !attempt.opened &&
        !(await retry_when(
          page,
          () =>
            page.take_error() !== undefined ||
            (page.target !== target && page.target.restart),
        ))
      ) {
        return
      }
    }
  } finally {
    try {
      await sources.return?.()
    } finally {
      await page.return()
    }
  }
}

const play_subtitle = async (signal: AbortSignal): Promise<void> => {
  if (!subtitle || signal.aborted) {
    return
  }
  for (;;) {
    const loaded = first(signal, subtitle, "load", "error")
    subtitle.src = source_url(subtitle, 0)
    const event = await loaded
    if (event === undefined || event.type === "load") {
      return
    }
    console.error(event)
    if (!(await delay(signal, RETRY_DELAY)) || signal.aborted) {
      return
    }
  }
}

const playback_page = async (signal: AbortSignal): Promise<void> => {
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

const main = async (): Promise<void> => {
  form.onsubmit = submit
  persist_position(initial_position)
  await run_page(playback_page)
}

void main().catch(console.error)

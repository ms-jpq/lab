import {
  aligned,
  buffered_end,
  buffered_position,
  media_events,
  media_snapshot,
  play_ahead,
  playable_position,
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
type RequestOutcome =
  | { action: "done" }
  | { action: "restart"; start?: number }
  | { action: "retry"; start: number }
type OwnedStream<T, R> = {
  next: () => Promise<IteratorResult<T, R>>
  return: () => Promise<IteratorResult<T, R>>
}
type RequestStream = OwnedStream<Uint8Array, { error: unknown } | void>
type SourceOperation = MseOperation | Failure
type PlaybackFailure = Failure & { opened: boolean }
type Reporter = (error: unknown) => void
type Target = { position: number; restart: boolean; started: boolean }
type StreamSelection<T> =
  { error: unknown } | { result: IteratorResult<T, void> }

const PULSE = Symbol()

type PageReader = {
  next: <T>(work?: Promise<T>) => Promise<typeof PULSE | T | undefined>
  return: () => Promise<IteratorResult<typeof PULSE, void>>
  seek: () => void
  take_error: () => unknown
  target: Target
}

const SOURCE = Symbol()
const WAIT = Symbol()
const BUFFER = {
  // TODO: https://bugzilla.mozilla.org/show_bug.cgi?id=1808868
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

const stream_position = (value: number) => Math.round(value * 1_000) / 1_000

const owned_stream = <T, R>(
  stream: AsyncGenerator<T, R, void>,
  cancel: () => void,
): OwnedStream<T, R> => {
  let active = true
  return {
    next: async () => {
      const next = await stream.next()
      active = !next.done
      return next
    },
    return: async () => {
      if (active) {
        active = false
        cancel()
      }
      return stream.return(undefined as R)
    },
  }
}

const selector = <T>(source: OwnedStream<T, void>) => {
  let available: StreamSelection<T> | undefined = undefined
  let notify: ((value: unknown) => void) | undefined = undefined
  const settle = (selection: StreamSelection<T>) => {
    available = selection
    notify?.(SOURCE)
  }
  const advance = () =>
    source.next().then(
      (result) => settle({ result }),
      (error) => settle({ error }),
    )
  advance()

  return {
    next: async <W>(work?: Promise<W>): Promise<T | W | undefined> => {
      if (!available) {
        const selected = await new Promise<unknown>((resolve, reject) => {
          const awaken = (value: unknown) => {
            if (notify === awaken) {
              notify = undefined
              resolve(value)
            }
          }
          notify = awaken
          work?.then(awaken, reject)
        })
        if (selected !== SOURCE) {
          return selected as W
        }
      }
      const selection = available as StreamSelection<T>
      if ("error" in selection) {
        throw selection.error
      }
      if (selection.result.done) {
        return undefined
      }
      available = undefined
      advance()
      return selection.result.value
    },
    return: () => source.return(),
  }
}

const page_reader = (signal: AbortSignal, position: number): PageReader => {
  const lifetime = abortion(signal)
  let target = { position, restart: false, started: false }
  let positioning: Target | undefined = target
  let failure: unknown | undefined = undefined
  let current = media_snapshot(media)
  let previous = current
  const observations = media_events(media, lifetime.signal)
  const seek = () => {
    target.started = false
    positioning = target
    media.currentTime = target.position
  }
  const take_error = () => {
    const error = failure
    failure = undefined
    return error
  }
  const pulses = owned_stream(
    (async function* (): AsyncGenerator<typeof PULSE, void, void> {
      try {
        let handled = target
        yield PULSE
        for await (const batch of observations) {
          for (const { event, snapshot } of batch) {
            current = snapshot
            const { error } = snapshot
            if (
              event.type === "error" &&
              error !== null &&
              error.code !== MediaError.MEDIA_ERR_ABORTED
            ) {
              failure ??= error
            }
            const owned =
              positioning !== undefined &&
              aligned(current.time, positioning.position)
                ? positioning
                : undefined
            if (
              (event.type === "seeking" || event.type === "seeked") &&
              owned
            ) {
              owned.started = true
            }
            if (current.seeking && !owned) {
              const position = playable_position(media, current.time)
              target = {
                position: buffered_position(current, position) ?? position,
                restart: false,
                started: true,
              }
            }
          }
          const moved =
            current.time !== previous.time ||
            current.seeking !== previous.seeking
          const user_seek = target !== handled

          if (user_seek) {
            const playable = buffered_position(current, target.position)
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
            buffered_position(current, current.time) === current.time
          ) {
            persist_position(current.time)
          }

          if (positioning !== undefined) {
            const playable = buffered_position(current, positioning.position)
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
          yield PULSE
        }
        return
      } finally {
        lifetime[Symbol.dispose]()
      }
    })(),
    () => lifetime[Symbol.dispose](),
  )
  const changes = selector(pulses)
  return {
    ...changes,
    get target() {
      return target
    },
    seek,
    take_error,
  }
}

const request_stream = (time: number): RequestStream => {
  const request = abortion()
  const stream = (async function* (): AsyncGenerator<
    Uint8Array,
    { error: unknown } | void,
    void
  > {
    const logical = logical_stream(
      new Request(source_url(media, time), { signal: request.signal }),
    )
    try {
      for (;;) {
        const next = await logical.next()
        if (next.done) {
          return
        }
        yield next.value
      }
    } catch (error) {
      return request.signal.aborted ? undefined : { error }
    } finally {
      try {
        await logical.return(undefined)
      } finally {
        request[Symbol.dispose]()
      }
    }
  })()
  return owned_stream(stream, () => request[Symbol.dispose]())
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
  return await wait_until(page, delay(timer.signal, RETRY_DELAY), (change) => {
    if (change === undefined) {
      return false
    }
    if (change !== PULSE || interrupted()) {
      return true
    }
    return WAIT
  })
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

const request_operations = async function* (
  page: PageReader,
  stream: RequestStream,
  start: number,
  retarget: (frontier: number) => boolean,
): AsyncGenerator<SourceOperation, RequestOutcome, void> {
  let frontier = stream_position(start)
  yield frontier
  if (retarget(frontier)) {
    return { action: "restart" }
  }

  for (;;) {
    const change = await wait_until(page, stream.next(), (change) =>
      change !== PULSE || retarget(frontier) ? change : WAIT,
    )
    if (change === undefined) {
      return { action: "done" }
    }
    if (change === PULSE) {
      return { action: "restart" }
    }
    if (change.done) {
      if (!change.value) {
        yield undefined
        const action = await wait_until(page, undefined, (change) => {
          if (change === undefined) {
            return "done"
          }
          return retarget(frontier) ? "restart" : WAIT
        })
        return { action }
      }
      yield { failure: change.value.error }
      return {
        action: "retry",
        start: stream_position(buffered_end(media, frontier) ?? frontier),
      }
    }

    yield change.value
    const next = stream_position(buffered_end(media, frontier) ?? frontier)
    frontier = next
    if (retarget(frontier)) {
      return { action: "restart" }
    }
    if (play_ahead(media, frontier) >= BUFFER.HI) {
      return { action: "restart", start: frontier }
    }
  }
}

const source_stream = async function* (
  page: PageReader,
): AsyncGenerator<SourceOperation, void, void> {
  let target = page.target
  let start = target.position
  const retarget = (frontier: number) => {
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

  for (;;) {
    retarget(start)
    const demanded = await wait_for_demand(page, start, retarget)
    if (demanded === undefined) {
      return
    }
    if (demanded === "restart") {
      continue
    }
    const stream = request_stream(start)

    try {
      const outcome = yield* request_operations(page, stream, start, retarget)
      if (outcome.action === "done") {
        return
      }
      if (outcome.start !== undefined) {
        start = outcome.start
      }
      if (outcome.action === "restart") {
        continue
      }
    } finally {
      await stream.return()
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

const play_source = async (
  buffer: Mse,
  report: Reporter,
  page: PageReader,
): Promise<Failure | void> => {
  const stream = source_stream(page)
  try {
    for (;;) {
      const selected = await result(stream.next())
      if ("failure" in selected) {
        return selected
      }
      const next = selected.value
      if (next.done) {
        return
      }
      const operation = next.value
      if (typeof operation === "object" && "failure" in operation) {
        report(operation.failure)
        continue
      }
      const mutated = await result(buffer.next(operation))
      if ("failure" in mutated) {
        return mutated
      }
      if (mutated.value.done) {
        return
      }
    }
  } finally {
    await stream.return()
  }
}

const play_attempt = async (
  signal: AbortSignal,
  sources: ReturnType<typeof media_sources>,
  report: Reporter,
  page: PageReader,
): Promise<PlaybackFailure | undefined> => {
  const opened = await result(
    (async (): Promise<Mse | undefined> => {
      const opening = sources.next()
      page.seek()
      const next = await opening
      if (next.done) {
        return undefined
      }
      if (signal.aborted) {
        return undefined
      }

      const [source, create_buffer] = next.value
      const duration = Number(media.dataset["duration"])
      if (duration > 0) {
        source.duration = duration
      }
      const buffer = create_buffer(signal)
      const primed = await buffer.next()
      return primed.done ? undefined : buffer
    })(),
  )
  if ("failure" in opened) {
    return signal.aborted
      ? undefined
      : { failure: opened.failure, opened: false }
  }
  if (opened.value === undefined) {
    return undefined
  }

  const played = await play_source(opened.value, report, page)
  return !played || signal.aborted
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
    while (!signal.aborted) {
      const page_failure = page.take_error()
      if (page_failure !== undefined) {
        report(page_failure)
      }
      const target = page.target
      const attempt = await play_attempt(signal, sources, report, page)
      if (!attempt) {
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
  if (!subtitle) {
    return
  }
  while (!signal.aborted) {
    const loaded = first(signal, subtitle, "load", "error")
    subtitle.src = source_url(subtitle, 0)
    const event = await loaded
    if (!event || event.type === "load") {
      return
    }
    console.error(event)
    if (!(await delay(signal, RETRY_DELAY))) {
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

type MseOperation = "end" | number | Uint8Array
type Mse = AsyncGenerator<void, void, MseOperation>
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
type Diagnostics = {
  error: (error: unknown) => void
  progress: () => void
}
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
  BEHIND: 30,
  // TODO: https://bugzilla.mozilla.org/show_bug.cgi?id=1808868
  LO: 45,
  HI: 60,
}
const RETRY_DELAY = 1_000
const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5
const POSITION = `media:position:${location.pathname}`
const PAGE = crypto.randomUUID()
const MEDIA_EVENTS =
  "canplay ended error loadedmetadata progress seeked seeking timeupdate waiting".split(
    " ",
  )

const media = document.querySelector("video, audio") as HTMLMediaElement
const subtitle = document.querySelector("#subtitle") as HTMLTrackElement | null
const form = document.querySelector("form") as HTMLFormElement
const time_input = form.elements.namedItem("t") as HTMLInputElement
const MediaSourceConstructor =
  (
    globalThis as typeof globalThis & {
      ManagedMediaSource?: typeof MediaSource
    }
  ).ManagedMediaSource ?? MediaSource

const first_event = (
  target: EventTarget,
  signal: AbortSignal,
  ...types: string[]
): Promise<Event | undefined> => {
  const { promise, resolve } = Promise.withResolvers<Event | undefined>()
  const close = (event?: Event) => {
    signal.removeEventListener("abort", cancelled)
    for (const type of types) {
      target.removeEventListener(type, observe)
    }
    resolve(event)
  }
  const observe = (event: Event) => close(event)
  const cancelled = () => close()
  for (const type of types) {
    target.addEventListener(type, observe)
  }
  signal.addEventListener("abort", cancelled, { once: true })
  if (signal.aborted) {
    cancelled()
  }
  return promise
}

const delay = (signal: AbortSignal, milliseconds: number): Promise<boolean> => {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  const { promise, resolve } = Promise.withResolvers<boolean>()
  const cancelled = () => {
    clearTimeout(timeout)
    resolve(false)
  }
  const timeout = setTimeout(() => {
    signal.removeEventListener("abort", cancelled)
    resolve(true)
  }, milliseconds)
  signal.addEventListener("abort", cancelled, { once: true })
  return promise
}

const result = <T>(promise: Promise<T>): Promise<Result<T>> =>
  promise.then(
    (value) => ({ value }),
    (failure) => ({ failure }),
  )

const revoke_url = (url: string | undefined) => url && URL.revokeObjectURL(url)

const diagnostics = (): Diagnostics => {
  let failed = false
  return {
    error: (error) => {
      if (failed) {
        return
      }
      failed = true
      console.error(error)
    },
    progress: () => {
      failed = false
    },
  }
}

const source_url = (
  resource: HTMLMediaElement | HTMLTrackElement,
  time: number,
) => {
  const path = resource.dataset["src"] as string
  const source = new URL(path, location.href)
  source.searchParams.set("t", String(time))
  source.searchParams.set("page", PAGE)
  source.searchParams.set("request", crypto.randomUUID())
  return source.toString()
}

const playable_position = (value: number) => {
  const duration = Number(media.dataset["duration"])
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

const stream_position = (value: number) => Math.round(value * 1_000) / 1_000

const aligned = (left: number, right: number) =>
  Math.abs(left - right) <= POSITION_TOLERANCE

const buffered_range = (
  position: number,
  inclusive: boolean,
): [number, number] | undefined => {
  const ranges = media.buffered
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index)
    const end = ranges.end(index)
    if (
      start - position <= POSITION_TOLERANCE &&
      (inclusive ? position <= end : position < end)
    ) {
      return [start, end]
    }
  }
  return undefined
}

const buffered_position = (position: number) => {
  const range = buffered_range(position, false)
  return range ? Math.max(position, range.at(0) ?? -Infinity) : undefined
}

const buffered_end = (position: number) => buffered_range(position, true)?.at(1)

const play_ahead = (frontier: number) => {
  const end = buffered_end(media.currentTime)
  const frontier_end = buffered_end(frontier)
  return end !== undefined && aligned(end, frontier_end ?? NaN)
    ? end - media.currentTime
    : 0
}

const initial_position = (() => {
  if (new URL(location.href).searchParams.has("t")) {
    return playable_position(Number(time_input.value))
  }
  try {
    const stored = Number(localStorage.getItem(POSITION))
    return playable_position(stored)
  } catch {
    return 0
  }
})()

const persist_position = (value: number) => {
  const page_url = new URL(location.href)
  const position = Math.floor(value)
  if (Number(time_input.value) === position) {
    return
  }
  time_input.value = String(position)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
  try {
    localStorage.setItem(POSITION, time_input.value)
  } catch {}
}

const media_observation = () => ({
  ended: media.ended,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

const observe_media = (
  signal: AbortSignal,
  observe: (event: Event) => void,
) => {
  for (const type of MEDIA_EVENTS) {
    media.addEventListener(type, observe, { signal })
  }
}

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
  const lifetime = new AbortController()
  const page_signal = AbortSignal.any([signal, lifetime.signal])
  let target = { position, restart: false, started: false }
  let positioning: Target | undefined = target
  let failure: unknown | undefined = undefined
  let current = media_observation()
  let previous = current
  let changed = Promise.withResolvers<boolean>()
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
  const observe = (event: Event) => {
    current = media_observation()
    const error = media.error
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
      const position = playable_position(current.time)
      target = {
        position: buffered_position(position) ?? position,
        restart: false,
        started: true,
      }
    }
    changed.resolve(true)
  }
  page_signal.addEventListener("abort", () => changed.resolve(false), {
    once: true,
  })
  observe_media(page_signal, observe)

  const pulses = owned_stream(
    (async function* (): AsyncGenerator<typeof PULSE, void, void> {
      let handled = target
      yield PULSE
      for (;;) {
        if (!(await changed.promise) || page_signal.aborted) {
          return
        }
        changed = Promise.withResolvers()
        const moved =
          current.time !== previous.time || current.seeking !== previous.seeking
        const user_seek = target !== handled

        if (user_seek) {
          const playable = buffered_position(target.position)
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
          buffered_position(current.time) === current.time
        ) {
          persist_position(current.time)
        }

        if (positioning !== undefined) {
          const playable = buffered_position(positioning.position)
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
    })(),
    () => lifetime.abort(),
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

const mse = async function* (
  signal: AbortSignal,
  source: MediaSource,
  buffer: SourceBuffer,
): Mse {
  const update = async (mutate: () => void) => {
    const operation = new AbortController()
    try {
      const settled = first_event(
        buffer,
        operation.signal,
        "updateend",
        "error",
      )
      mutate()
      const event = await settled
      if (event?.type === "error") {
        throw event
      }
    } finally {
      operation.abort()
    }
  }

  let started = false
  for (let operation = yield undefined; ; operation = yield undefined) {
    if (signal.aborted) {
      return
    }
    if (operation === "end") {
      source.endOfStream()
      continue
    }
    if (typeof operation === "number") {
      if (started) {
        if (source.readyState === "ended") {
          const ranges = buffer.buffered
          const end = ranges.length ? ranges.end(ranges.length - 1) : 0
          await update(() => buffer.remove(end, end + 0.001))
        }
        buffer.abort()
      }
      buffer.timestampOffset = operation
      started = true
      continue
    }

    const expired = media.currentTime - BUFFER.BEHIND
    const ranges = buffer.buffered
    if (expired > 0 && ranges.length && ranges.start(0) < expired) {
      await update(() => buffer.remove(0, expired))
    }
    await update(() =>
      buffer.appendBuffer(operation as Uint8Array<ArrayBuffer>),
    )
  }
}

const request_stream = (time: number): RequestStream => {
  const request = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined = undefined
  const stream = (async function* (): AsyncGenerator<
    Uint8Array,
    { error: unknown } | void,
    void
  > {
    try {
      const response = await fetch(source_url(media, time), {
        signal: request.signal,
      })
      if (!response.body) {
        throw new Error(`${response.statusText} - ${response.status}`)
      }
      reader = response.body.getReader()
      if (!response.ok) {
        throw new Error(`${response.statusText} - ${response.status}`)
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          reader = undefined
          return
        }
        yield value
      }
    } catch (error) {
      return request.signal.aborted ? undefined : { error }
    } finally {
      if (reader) {
        request.abort()
        try {
          await reader.cancel()
        } catch {}
      }
    }
  })()
  return owned_stream(stream, () => request.abort())
}

const play_subtitle = async (signal: AbortSignal): Promise<void> => {
  if (!subtitle) {
    return
  }
  const failures = diagnostics()
  while (!signal.aborted) {
    const loaded = first_event(subtitle, signal, "load", "error")
    subtitle.src = source_url(subtitle, 0)
    const event = await loaded
    if (!event || event.type === "load") {
      return
    }
    failures.error(event)
    if (!(await delay(signal, RETRY_DELAY))) {
      return
    }
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
  const timer = new AbortController()
  try {
    return await wait_until(
      page,
      delay(timer.signal, RETRY_DELAY),
      (change) => {
        if (change === undefined) {
          return false
        }
        if (change !== PULSE || interrupted()) {
          return true
        }
        return WAIT
      },
    )
  } finally {
    timer.abort()
  }
}

const wait_for_demand = (
  page: PageReader,
  start: number,
  retarget: (frontier: number) => boolean,
): Promise<"ready" | "restart" | undefined> =>
  play_ahead(start) < BUFFER.LO
    ? Promise.resolve("ready")
    : wait_until(page, undefined, (change) => {
        if (change === undefined) {
          return undefined
        }
        if (retarget(start)) {
          return "restart"
        }
        return play_ahead(start) < BUFFER.LO ? "ready" : WAIT
      })

const request_operations = async function* (
  failures: Diagnostics,
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
        yield "end"
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
        start: stream_position(buffered_end(frontier) ?? frontier),
      }
    }

    yield change.value
    const next = stream_position(buffered_end(frontier) ?? frontier)
    if (next > frontier) {
      failures.progress()
    }
    frontier = next
    if (retarget(frontier)) {
      return { action: "restart" }
    }
    if (play_ahead(frontier) >= BUFFER.HI) {
      return { action: "restart", start: frontier }
    }
  }
}

const source_stream = async function* (
  failures: Diagnostics,
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
      buffered_position(target.position) === undefined &&
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
      const outcome = yield* request_operations(
        failures,
        page,
        stream,
        start,
        retarget,
      )
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
  failures: Diagnostics,
  page: PageReader,
): Promise<Failure | void> => {
  const stream = source_stream(failures, page)
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
        failures.error(operation.failure)
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

const media_sources = () => {
  let url: string | undefined = undefined
  return {
    close: () => {
      try {
        media.removeAttribute("src")
        media.load()
      } finally {
        revoke_url(url)
      }
    },
    open: async (signal: AbortSignal, page: PageReader) => {
      const source = new MediaSourceConstructor()
      const previous = url
      const next = URL.createObjectURL(source)
      const opening = new AbortController()
      const opened = first_event(
        source,
        AbortSignal.any([signal, opening.signal]),
        "sourceopen",
        "sourceclose",
      )
      try {
        media.src = next
      } catch (error) {
        opening.abort()
        revoke_url(next)
        throw error
      }
      url = next
      try {
        page.seek()
        const event = await opened
        if (!event || signal.aborted) {
          return undefined
        }
        if (event.type !== "sourceopen") {
          throw event
        }
        const duration = Number(media.dataset["duration"])
        if (duration > 0) {
          source.duration = duration
        }
        const buffer = mse(
          signal,
          source,
          source.addSourceBuffer(media.dataset["mseType"] as string),
        )
        await buffer.next()
        return buffer
      } finally {
        opening.abort()
        revoke_url(previous)
      }
    },
  }
}

const play_attempt = async (
  signal: AbortSignal,
  sources: ReturnType<typeof media_sources>,
  failures: Diagnostics,
  page: PageReader,
) => {
  const opened = await result(sources.open(signal, page))
  if ("failure" in opened) {
    return signal.aborted
      ? undefined
      : { failure: opened.failure, opened: false }
  }
  const buffer = opened.value
  if (!buffer) {
    return undefined
  }
  try {
    const played = await play_source(buffer, failures, page)
    return !played || signal.aborted
      ? undefined
      : {
          failure: page.take_error() ?? played.failure,
          opened: true,
        }
  } finally {
    await buffer.return()
  }
}

const play_media = async (signal: AbortSignal): Promise<void> => {
  const page = page_reader(signal, playable_position(Number(time_input.value)))
  const failures = diagnostics()
  const sources = media_sources()
  try {
    while (!signal.aborted) {
      const page_failure = page.take_error()
      if (page_failure !== undefined) {
        failures.error(page_failure)
      }
      const target = page.target
      const attempt = await play_attempt(signal, sources, failures, page)
      if (!attempt) {
        return
      }
      failures.error(attempt.failure)
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
      sources.close()
    } finally {
      await page.return()
    }
  }
}

const playback_page = async (signal: AbortSignal): Promise<void> => {
  const lifetime = new AbortController()
  const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
  const playback = play_media(lifetime_signal)
  const captions = play_subtitle(lifetime_signal).then(() => playback)
  try {
    await Promise.race([playback, captions])
  } finally {
    lifetime.abort()
    await Promise.allSettled([playback, captions])
  }
}

const submit = (event: SubmitEvent): void => {
  if (event.submitter?.classList.contains("back")) {
    return
  }
  event.preventDefault()
  const target = new URL(form.action)
  const query = new URLSearchParams()
  for (const [name, value] of new FormData(form)) {
    if (typeof value === "string") {
      query.append(name, value)
    }
  }
  target.search = query.toString()
  location.replace(target)
}

const main = async (): Promise<void> => {
  persist_position(initial_position)
  for (;;) {
    const page = new AbortController()
    await first_event(window, page.signal, "pageshow")
    const playback = playback_page(page.signal)
    try {
      await Promise.race([
        first_event(window, page.signal, "pagehide"),
        playback,
      ])
    } finally {
      page.abort()
      await playback
    }
  }
}

form.onsubmit = submit
void main().catch(console.error)

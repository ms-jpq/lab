/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined>} Mse */
/** @typedef {{error: MediaError | null, position: number, seek: number | undefined}} PageChange */
/** @typedef {{buffer: Mse, position: number, signal: AbortSignal}} PlaybackSource */
/** @typedef {{error?: unknown, position: number}} SourceChange */
/** @typedef {{error: unknown}} Failure */
/** @typedef {{next: Promise<IteratorResult<PageChange, void>>}} PageReader */
/** @typedef {{action: "done" | "retry" | "seek", error?: unknown, position: number}} AttemptChange */

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

const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)
const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)
const form = /** @type {HTMLFormElement} */ (document.querySelector("form"))
const time_input = /** @type {HTMLInputElement} */ (
  form.elements.namedItem("t")
)

/** @param {EventTarget} target @param {AbortSignal | undefined} signal @param {string} type @returns {Promise<Event>} */
const once = (target, signal, type) => {
  const { promise, reject, resolve } = Promise.withResolvers()
  target.addEventListener(
    type,
    (event) => (type === "error" ? reject(event) : resolve(event)),
    { once: true, signal },
  )
  return promise
}

/**
 * @template T
 * @param {AbortSignal} signal
 * @param {...(((signal: AbortSignal) => Promise<T>) | undefined)} cases
 * @returns {Promise<T | undefined>}
 */
const select = async (signal, ...cases) => {
  if (signal.aborted) {
    return undefined
  }

  const selection = new AbortController()
  try {
    return await Promise.race([
      once(signal, selection.signal, "abort").then(() => undefined),
      ...cases.flatMap((run) => (run ? [run(selection.signal)] : [])),
    ])
  } finally {
    selection.abort()
  }
}

/** @param {AbortSignal} signal */
const retry_delay = (signal) => {
  const { promise, resolve } = Promise.withResolvers()
  if (signal.aborted) {
    resolve(false)
    return promise
  }
  const timeout = setTimeout(() => {
    signal.removeEventListener("abort", cancelled)
    resolve(true)
  }, RETRY_DELAY)
  const cancelled = () => {
    clearTimeout(timeout)
    resolve(false)
  }
  signal.addEventListener("abort", cancelled, { once: true })
  return promise
}

/** @param {unknown} error */
const report = (error) => console.error(error)

/** @param {HTMLMediaElement | HTMLTrackElement} resource @param {number} time */
const source_url = (resource, time) => {
  const source = new URL(
    /** @type {string} */ (resource.dataset.src),
    location.href,
  )
  source.searchParams.set("t", String(time))
  source.searchParams.set("page", PAGE)
  source.searchParams.set("request", crypto.randomUUID())
  return source.toString()
}

/** @param {number} value */
const playable_position = (value) => {
  const duration = Number(media.dataset.duration)
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

/** @param {number} value */
const stream_position = (value) => Math.round(value * 1_000) / 1_000

/** @param {number} position */
const buffered_range = (position) => {
  const ranges = media.buffered
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index)
    const end = ranges.end(index)
    if (position < end) {
      return { end, start }
    }
  }
  return undefined
}

/** @param {number} position */
const available = (position) => {
  const range = buffered_range(position)
  if (!range) {
    return undefined
  }
  if (range.start <= position) {
    return position
  }
  return range.start - position <= POSITION_TOLERANCE ? range.start : undefined
}

const play_ahead = () => {
  const position = media.currentTime
  const range = buffered_range(position)
  return range && range.start - position <= POSITION_TOLERANCE
    ? range.end - position
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

/** @param {number} value */
const persist_position = (value) => {
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

const media_state = () => ({
  ended: media.ended,
  error: media.error,
  seeking: media.seeking,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @returns {AsyncGenerator<ReturnType<typeof media_state>[], void, void>} */
const media_state_batches = async function* (signal) {
  const types =
    "canplay ended error loadedmetadata progress seeked seeking timeupdate".split(
      " ",
    )
  /** @type {ReturnType<typeof media_state>[]} */
  const events = []
  let changed = Promise.withResolvers()

  const observe = () => {
    events.push(media_state())
    changed.resolve(true)
  }
  const cancelled = () => changed.resolve(false)

  signal.addEventListener("abort", cancelled, { once: true })
  for (const type of types) {
    media.addEventListener(type, observe)
  }
  observe()

  try {
    for (;;) {
      if ((events.length === 0 && !(await changed.promise)) || signal.aborted) {
        return
      }
      const states = events.splice(0)
      changed = Promise.withResolvers()
      yield states
    }
  } finally {
    signal.removeEventListener("abort", cancelled)
    for (const type of types) {
      media.removeEventListener(type, observe)
    }
  }
}

/** @param {AbortSignal} signal @param {number} position @returns {AsyncGenerator<PageChange, void, void>} */
const page_states = async function* (signal, position) {
  let previous = media_state()
  /** @type {number | undefined} */
  let pending_seek = position
  let target = position

  for await (const observed_states of media_state_batches(signal)) {
    /** @type {MediaError | null} */
    let error = null
    /** @type {number | undefined} */
    let seek = undefined

    for (const observed of observed_states) {
      let current = observed
      let moved =
        current.time !== previous.time || current.seeking !== previous.seeking
      const internal_seek =
        pending_seek !== undefined &&
        Math.abs(current.time - pending_seek) <= POSITION_TOLERANCE
      const user_seek = current.seeking && moved && !internal_seek
      let restart = false

      if (user_seek) {
        target = playable_position(current.time)
        const playable = available(target)
        target = playable ?? target
        restart = playable === undefined
        pending_seek =
          restart || Math.abs(current.time - target) > POSITION_TOLERANCE
            ? target
            : undefined
        seek = restart ? target : undefined
        persist_position(target)
      } else if (pending_seek !== undefined) {
        const playable = available(pending_seek)
        if (playable !== undefined) {
          pending_seek = playable
          target = playable
        }
        if (!media.seeking) {
          const positioned =
            Math.abs(media.currentTime - pending_seek) <= POSITION_TOLERANCE
          if (
            !positioned &&
            (media.readyState !== 0 || playable !== undefined)
          ) {
            media.currentTime = pending_seek
          } else if (positioned && playable !== undefined) {
            pending_seek = undefined
          }
        }
        current = media_state()
        moved =
          current.time !== previous.time || current.seeking !== previous.seeking
      }

      if (current.ended && !previous.ended) {
        persist_position(0)
      } else if (
        !user_seek &&
        pending_seek === undefined &&
        moved &&
        available(current.time) === current.time
      ) {
        persist_position(current.time)
      }

      if (
        error === null &&
        current.error !== previous.error &&
        current.error !== null &&
        current.error.code !== MediaError.MEDIA_ERR_ABORTED
      ) {
        error = current.error
      }
      previous = current
    }

    yield {
      error,
      position: target,
      seek,
    }
  }
}

/** @param {AbortSignal} signal @param {HTMLMediaElement} media @param {MediaSource} source @param {SourceBuffer} buffer @returns {Mse} */
const mse = (signal, media, source, buffer) => {
  /** @param {() => void} mutate */
  const update = async (mutate) => {
    if (signal.aborted) {
      return false
    }
    const settled = new AbortController()
    try {
      mutate()
      await Promise.race([
        once(buffer, settled.signal, "updateend"),
        once(buffer, settled.signal, "error"),
      ])
      return true
    } finally {
      settled.abort()
    }
  }

  return (async function* () {
    let started = false
    for (
      let operation = yield undefined;
      operation !== undefined;
      operation = yield undefined
    ) {
      if (operation === "end") {
        source.endOfStream()
        continue
      }
      if (typeof operation === "number") {
        if (started) {
          if (source.readyState === "ended") {
            const ranges = buffer.buffered
            const end = ranges.length ? ranges.end(ranges.length - 1) : 0
            if (!(await update(() => buffer.remove(end, end + 0.001)))) {
              return
            }
          }
          buffer.abort()
        }
        buffer.timestampOffset = operation
        started = true
        continue
      }

      const expired = media.currentTime - BUFFER.BEHIND
      const ranges = buffer.buffered
      if (
        expired > 0 &&
        ranges.length &&
        ranges.start(0) < expired &&
        !(await update(() => buffer.remove(0, expired)))
      ) {
        return
      }
      if (
        !(await update(() =>
          buffer.appendBuffer(
            /** @type {Uint8Array<ArrayBuffer>} */ (operation),
          ),
        ))
      ) {
        return
      }
    }
    return
  })()
}

/** @param {AbortSignal} signal @param {number} time @returns {AsyncGenerator<Uint8Array, Failure | void, void>} */
const source_stream = async function* (signal, time) {
  const request = new AbortController()
  const request_signal = AbortSignal.any([signal, request.signal])
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader = undefined
  try {
    const response = await fetch(source_url(media, time), {
      signal: request_signal,
    })
    if (!response.ok || !response.body) {
      throw new Error(`${response.statusText} - ${response.status}`)
    }
    reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        reader = undefined
        return
      }
      yield value
    }
  } catch (error) {
    if (!request_signal.aborted) {
      return { error }
    }
  } finally {
    if (reader) {
      request.abort()
      try {
        await reader.cancel()
      } catch {}
    }
  }
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} time @returns {AsyncGenerator<void, Failure | void, void>} */
const session = async function* (signal, buffer, time) {
  const start = stream_position(time)

  while (play_ahead() >= BUFFER.LO) {
    yield undefined
  }
  if ((await buffer.next(start)).done) {
    return
  }
  const stream = source_stream(signal, start)
  try {
    for (;;) {
      const next = await stream.next()
      if (next.done) {
        if (next.value) {
          return next.value
        }
        break
      }
      if ((await buffer.next(next.value)).done) {
        return
      }
      if (play_ahead() >= BUFFER.HI) {
        do {
          yield undefined
        } while (play_ahead() >= BUFFER.LO)
      }
    }
  } finally {
    await stream.return()
  }
  if (!signal.aborted && !(await buffer.next("end")).done) {
    await select(signal)
  }
  return
}

/** @param {AbortSignal} signal @param {number} position @returns {AsyncGenerator<PlaybackSource, void, SourceChange | undefined>} */
const media_sources = async function* (signal, position) {
  for (;;) {
    const lifetime = new AbortController()
    const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
    const { ManagedMediaSource } =
      /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
        globalThis
      )
    const source = new (ManagedMediaSource ?? MediaSource)()
    const opened = select(
      lifetime_signal,
      (s) => once(source, s, "sourceopen"),
      (s) =>
        once(source, s, "sourceclose").then((event) => {
          throw event
        }),
    )
    const url = URL.createObjectURL(source)
    media.src = url
    /** @type {Mse | undefined} */
    let buffer = undefined
    let retry = false

    try {
      const selected = await opened
      if (!selected) {
        return
      }
      const duration = Number(media.dataset.duration)
      if (duration > 0) {
        source.duration = duration
      }
      buffer = mse(
        lifetime_signal,
        media,
        source,
        source.addSourceBuffer(/** @type {string} */ (media.dataset.mseType)),
      )
      if ((await buffer.next()).done) {
        return
      }
      const change = yield { buffer, position, signal: lifetime_signal }
      position = change?.position ?? position
      if (change?.error !== undefined) {
        report(change.error)
      }
      retry =
        change?.error !== undefined
          ? !signal.aborted
          : await retry_delay(signal)
    } catch (error) {
      if (!lifetime_signal.aborted) {
        report(error)
      }
      retry = await retry_delay(signal)
    } finally {
      lifetime.abort()
      await buffer?.return()
      media.removeAttribute("src")
      media.load()
      URL.revokeObjectURL(url)
    }

    if (!retry) {
      return
    }
  }
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {AsyncGenerator<PageChange, void, void>} states @param {PageReader} page @param {number} position @returns {Promise<AttemptChange>} */
const play_attempt = async (signal, buffer, states, page, position) => {
  const attempt = new AbortController()
  const attempt_signal = AbortSignal.any([signal, attempt.signal])
  const current = session(attempt_signal, buffer, position)
  /** @type {Promise<IteratorResult<void, Failure | void>> | undefined} */
  let progress = current.next()
  try {
    for (;;) {
      const selected = await Promise.race([
        page.next.then((result) => ({ page: result })),
        ...(progress
          ? [progress.then((result) => ({ progress: result }))]
          : []),
      ])
      if ("progress" in selected) {
        const { progress: result } = selected
        progress = undefined
        if (result.done) {
          return result.value
            ? { action: "retry", error: result.value.error, position }
            : { action: "done", position }
        }
        continue
      }

      const state = selected.page
      if (state.done) {
        return { action: "done", position }
      }
      position = state.value.position
      if (state.value.error) {
        throw state.value.error
      }
      page.next = states.next()
      if (state.value.seek !== undefined) {
        return { action: "seek", position }
      }
      if (progress === undefined) {
        progress = current.next()
      }
    }
  } finally {
    attempt.abort()
    await current.return()
  }
}

/** @param {AbortSignal} signal @param {AsyncGenerator<PageChange, void, void>} states @param {PageReader} page @param {number} position @returns {Promise<number | undefined>} */
const wait_to_retry = async (signal, states, page, position) => {
  const timer = new AbortController()
  const delay = retry_delay(AbortSignal.any([signal, timer.signal]))
  try {
    for (;;) {
      const selected = await Promise.race([
        page.next.then((result) => ({ page: result })),
        delay.then((result) => ({ delay: result })),
      ])
      if ("delay" in selected) {
        return selected.delay ? position : undefined
      }
      const state = selected.page
      if (state.done) {
        return undefined
      }
      position = state.value.position
      if (state.value.error) {
        throw state.value.error
      }
      page.next = states.next()
      if (state.value.seek !== undefined) {
        return position
      }
    }
  } finally {
    timer.abort()
  }
}

/** @param {PlaybackSource} source @returns {Promise<SourceChange>} */
const play_source = async ({ buffer, position, signal }) => {
  const observation = new AbortController()
  const states = page_states(
    AbortSignal.any([signal, observation.signal]),
    position,
  )
  const page = { next: states.next() }
  let failure_reported = false
  try {
    for (;;) {
      const change = await play_attempt(signal, buffer, states, page, position)
      position = change.position
      if (change.action === "done") {
        return { position }
      }
      if (change.action === "retry") {
        if (!failure_reported) {
          report(change.error)
          failure_reported = true
        }
        const waiting = await wait_to_retry(signal, states, page, position)
        if (waiting === undefined) {
          return { position }
        }
        position = waiting
      }
    }
  } catch (error) {
    return signal.aborted ? { position } : { error, position }
  } finally {
    observation.abort()
    await states.return()
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  const sources = media_sources(signal, initial_position)
  try {
    let next = await sources.next()
    while (!next.done) {
      const source = next.value
      const change = await play_source(source)
      next = await sources.next(change)
    }
  } finally {
    await sources.return()
  }
}

/** @param {SubmitEvent} event */
const submit = (event) => {
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

const main = async () => {
  persist_position(initial_position)
  if (subtitle && subtitle.src === "") {
    subtitle.src = source_url(subtitle, 0)
  }
  for (;;) {
    const page = new AbortController()
    await once(window, page.signal, "pageshow")
    const playback = playback_page(page.signal)
    try {
      await Promise.race([once(window, page.signal, "pagehide"), playback])
    } finally {
      page.abort()
      await playback
    }
  }
}

form.onsubmit = submit
void main().catch(report)

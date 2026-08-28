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

const BUFFER = {
  BEHIND: 30,
  // TODO: https://bugzilla.mozilla.org/show_bug.cgi?id=1808868
  LO: 45,
  HI: 60,
}
const RETRY_DELAY = 1_000
const POSITION_TOLERANCE = 0.1
const POSITION = `media:position:${location.pathname}`
const PAGE = crypto.randomUUID()
/** @typedef {number | readonly [position: number, bytes: Uint8Array]} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined> & {contains: (position: number) => boolean, frontier: () => number | undefined, play_ahead: (position: number) => number}} MseBuffer */
/** @typedef {(signal: AbortSignal) => MseBuffer} MseBufferFactory */
/** @typedef {AsyncGenerator<void, void, void> & {buffer: MseBuffer}} Attempt */
/** @typedef {ReturnType<typeof page_state> & {failed: boolean, moved: boolean}} PageChange */
/** @typedef {{state: IteratorResult<PageChange, void>} | {attempt: IteratorResult<void, void>}} PlaybackSelection */

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
 * @param {...((signal: AbortSignal) => Promise<T>)} cases
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
      ...cases.map((run) => run(selection.signal)),
    ])
  } finally {
    selection.abort()
  }
}

/** @param {AbortSignal} signal */
const retry_delay = (signal) =>
  select(signal, (s) => once(AbortSignal.timeout(RETRY_DELAY), s, "abort"))

/** @template T @param {AbortSignal} signal @param {() => AsyncIterable<T>} source @returns {AsyncGenerator<T, void, void>} */
const retrying = async function* (signal, source) {
  for (;;) {
    try {
      yield* source()
    } catch (error) {
      console.error(error)
    }
    if (!(await retry_delay(signal))) {
      return
    }
  }
}

/** @param {HTMLMediaElement | HTMLTrackElement} resource @param {number} time */
const source_url = (resource, time) => {
  const source = new URL(
    /** @type {string} */ (resource.dataset.src),
    location.href,
  )
  source.searchParams.set("t", String(Math.floor(time)))
  source.searchParams.set("page", PAGE)
  source.searchParams.set("request", crypto.randomUUID())
  return source.toString()
}

const transformed = media.dataset.transformed === "true"

const initial_position = (() => {
  if (new URL(location.href).searchParams.has("t")) {
    return Number(time_input.value)
  }
  try {
    const stored = Number(localStorage.getItem(POSITION))
    return Number.isFinite(stored) ? stored : 0
  } catch {
    return 0
  }
})()

/** @param {number} value */
const set_position = (value) => {
  const page_url = new URL(location.href)
  const rounded = Math.round(value * 1_000) / 1_000
  time_input.value = String(rounded)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
  try {
    localStorage.setItem(POSITION, time_input.value)
  } catch {}
}

const page_state = () => ({
  error: media.error,
  future: media.readyState >= media.HAVE_FUTURE_DATA,
  metadata: media.readyState >= media.HAVE_METADATA,
  paused: media.paused,
  seeking: media.seeking,
  subtitle_error: subtitle !== null && subtitle.readyState === subtitle.ERROR,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @returns {AsyncGenerator<PageChange, void, void>} */
const changes = (signal) => {
  let changed = Promise.withResolvers()
  let previous = page_state()
  const wake = () => changed.resolve(true)

  for (const type of "canplay error loadedmetadata pause play playing seeked seeking timeupdate waiting".split(
    " ",
  )) {
    media.addEventListener(type, wake, { signal })
  }
  for (const type of "error load".split(" ")) {
    subtitle?.addEventListener(type, wake, { signal })
  }
  wake()

  return (async function* () {
    for (;;) {
      if (!(await select(signal, () => changed.promise))) {
        return
      }
      changed = Promise.withResolvers()
      const current = page_state()
      yield {
        ...current,
        failed:
          (current.error !== previous.error &&
            current.error !== null &&
            current.error.code !== MediaError.MEDIA_ERR_ABORTED) ||
          (current.subtitle_error && !previous.subtitle_error),
        moved:
          Number.isFinite(current.time) &&
          (current.time !== previous.time ||
            current.seeking !== previous.seeking),
      }
      previous = current
    }
  })()
}

/** @param {MediaSource} source @param {SourceBuffer} buffer */
const abort_mse_update = async (source, buffer) => {
  if (source.readyState !== "open" || !buffer.updating) {
    return
  }
  const aborted = once(buffer, undefined, "updateend")
  buffer.abort()
  await aborted
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {SourceBuffer} buffer @param {() => void} mutate */
const mse_update = async (signal, source, buffer, mutate) => {
  if (signal.aborted) {
    return false
  }
  const settled = select(
    signal,
    (s) => once(buffer, s, "updateend"),
    (s) => once(buffer, s, "error"),
  )
  mutate()
  if (await settled) {
    return true
  }
  await abort_mse_update(source, buffer)
  return false
}

/** @param {SourceBuffer} buffer */
const mse_frontier = (buffer) => {
  const ranges = buffer.buffered
  const last = ranges.length - 1
  return last < 0 ? undefined : ranges.end(last)
}

/** @param {SourceBuffer} buffer @param {number} position */
const mse_contains = (buffer, position) => {
  const ranges = buffer.buffered
  for (let index = 0; index < ranges.length; index += 1) {
    if (ranges.start(index) <= position && position < ranges.end(index)) {
      return true
    }
  }
  return false
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {SourceBuffer} buffer @returns {AsyncGenerator<void, void, MseOperation | undefined>} */
const mse_operations = async function* (signal, source, buffer) {
  try {
    for (
      let operation = yield undefined;
      operation !== undefined;
      operation = yield undefined
    ) {
      if (typeof operation === "number") {
        buffer.timestampOffset = operation
      } else {
        const [position, bytes] = operation
        const end = position - BUFFER.BEHIND
        const expired =
          end > 0 && buffer.buffered.length && buffer.buffered.start(0) < end
        if (
          expired &&
          !(await mse_update(signal, source, buffer, () =>
            buffer.remove(0, end),
          ))
        ) {
          return
        }
        if (
          !(await mse_update(signal, source, buffer, () =>
            buffer.appendBuffer(bytes),
          ))
        ) {
          return
        }
      }
    }
    if (source.readyState === "open") {
      source.endOfStream()
    }
  } finally {
    await abort_mse_update(source, buffer)
    if (source.readyState !== "closed") {
      source.removeSourceBuffer(buffer)
    }
  }
  return
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {string} type @returns {MseBuffer} */
const mse_buffer = (signal, source, type) => {
  const buffer = source.addSourceBuffer(type)
  return Object.assign(mse_operations(signal, source, buffer), {
    /** @param {number} position */
    contains: (position) => mse_contains(buffer, position),
    frontier: () => mse_frontier(buffer),
    /** @param {number} position */
    play_ahead: (position) => (mse_frontier(buffer) ?? position) - position,
  })
}

/** @param {AbortSignal} signal @returns {AsyncGenerator<MseBufferFactory, void, void>} */
const mse = async function* (signal) {
  const { ManagedMediaSource } =
    /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
      globalThis
    )
  const source = new (ManagedMediaSource ?? MediaSource)()
  const type = /** @type {string} */ (media.dataset.mseType)
  const duration = Number(media.dataset.duration)
  const opened = select(
    signal,
    (s) => once(source, s, "sourceopen"),
    (s) => once(source, s, "sourceclose"),
  )
  const url = URL.createObjectURL(source)
  const previous = media.src
  media.src = url
  URL.revokeObjectURL(previous)

  try {
    const selected = await opened
    if (!selected) {
      return
    }
    if (selected.type === "sourceclose") {
      throw selected
    }
    if (duration > 0) {
      source.duration = duration
    }

    /** @type {MseBufferFactory} */
    const create_buffer = (buffer_signal) =>
      mse_buffer(buffer_signal, source, type)
    for (;;) {
      yield create_buffer
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  const request = new AbortController()
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader = undefined

  try {
    const response = await select(signal, () =>
      fetch(source_url(media, time), {
        signal: AbortSignal.any([signal, request.signal]),
      }),
    )
    if (!response) {
      return
    }
    const current = (reader = response.body?.getReader())
    if (!response.ok || !current) {
      throw new Error(`${response.statusText} - ${response.status}`)
    }
    for (;;) {
      const selected = await select(signal, () => current.read())
      if (!selected) {
        return
      }
      const { done, value } = selected
      if (done) {
        return
      }
      yield value
    }
  } finally {
    if (!signal.aborted) {
      await reader?.cancel()
    }
    request.abort()
  }
}

/** @param {AbortSignal} signal @param {MseBufferFactory} create_buffer @returns {Attempt} */
const attempt = (signal, create_buffer) => {
  const buffer = create_buffer(signal)
  const time = Number(time_input.value)
  let started = false

  const run = async function* () {
    try {
      await buffer.next()
      if (Math.abs(media.currentTime - time) > POSITION_TOLERANCE) {
        media.currentTime = time
      }

      streaming: for (;;) {
        while (buffer.play_ahead(media.currentTime) >= BUFFER.LO) {
          yield undefined
        }

        const start = buffer.frontier() ?? time
        if ((await buffer.next(start)).done) {
          break
        }
        for await (const bytes of source_stream(signal, start)) {
          if ((await buffer.next([media.currentTime, bytes])).done) {
            break streaming
          }
          if (!started) {
            started = true
            if (subtitle) {
              subtitle.src = source_url(subtitle, time)
            }
          }
          if (buffer.play_ahead(media.currentTime) >= BUFFER.HI) {
            continue streaming
          }
        }
        if (await select(signal, () => buffer.next())) {
          await select(signal)
        }
        break
      }
    } finally {
      await buffer.return()
    }
    return
  }

  return Object.assign(run(), { buffer })
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  const resume = Symbol("resume")
  const restart = Symbol("restart")
  const retry = Symbol("retry")
  const states = changes(signal)
  let changed = states.next()
  let positioned = transformed
  let waiting = false

  /** @param {PageChange} state @param {MseBuffer | undefined} buffer */
  const update = async (state, buffer) => {
    if (!positioned && state.metadata) {
      positioned = true
      if (initial_position > 0) {
        media.currentTime = initial_position
      }
    }

    const action =
      buffer && state.failed
        ? retry
        : buffer && state.moved && state.seeking && !buffer.contains(state.time)
          ? restart
          : buffer && (state.moved || !state.paused)
            ? resume
            : undefined

    if (state.moved && (buffer || !transformed)) {
      set_position(state.time)
    }
    if (!state.paused && !state.future) {
      waiting = true
      media.pause()
    } else if (state.paused && waiting && state.future) {
      waiting = false
      await media.play().catch(console.error)
    }
    return action
  }

  if (!transformed) {
    media.src = source_url(media, media.currentTime)
    media.load()
    for await (const change of states) {
      await update(change, undefined)
    }
    return
  }

  for await (const create_buffer of retrying(signal, () => mse(signal))) {
    const current = new AbortController()
    const attempt_signal = AbortSignal.any([signal, current.signal])
    const session = attempt(attempt_signal, create_buffer)
    /** @type {Promise<IteratorResult<void, void>> | undefined} */
    let progress = session.next()
    let transition = undefined

    try {
      for (;;) {
        const pending = progress
        const selected = await select(
          attempt_signal,
          () =>
            changed.then(
              (state) => /** @type {PlaybackSelection} */ ({ state }),
            ),
          ...(pending
            ? [
                () =>
                  pending.then(
                    (attempt) => /** @type {PlaybackSelection} */ ({ attempt }),
                  ),
              ]
            : []),
        )

        if (!selected) {
          break
        }
        if ("attempt" in selected) {
          progress = undefined
          if (selected.attempt.done) {
            break
          }
          continue
        }

        const { state } = selected
        if (state.done) {
          return
        }
        changed = states.next()
        transition = await update(state.value, session.buffer)
        if (transition === restart || transition === retry) {
          break
        }
        if (transition === resume && progress === undefined) {
          progress = session.next()
        }
      }
    } catch (error) {
      console.error(error)
    } finally {
      current.abort()
      await session.return()
    }

    if (transition !== restart && !(await retry_delay(signal))) {
      return
    }
  }
}

set_position(initial_position)

/** @param {SubmitEvent} event */
form.onsubmit = (event) => {
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

void (async () => {
  for (;;) {
    await once(window, undefined, "pageshow")
    const page = new AbortController()
    const playback = playback_page(page.signal)
    try {
      await Promise.race([once(window, page.signal, "pagehide"), playback])
    } finally {
      page.abort()
      await playback
    }
  }
})().catch(console.error)

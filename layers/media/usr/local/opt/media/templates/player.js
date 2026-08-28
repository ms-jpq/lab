/** @typedef {number | readonly [position: number, bytes: Uint8Array]} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined> & {active: () => boolean, available: (position: number) => number | undefined, changes: EventTarget, contains: (position: number) => boolean, end: () => boolean, frontier: (position: number) => number | undefined, play_ahead: (position: number) => number}} Mse */
/** @typedef {ReturnType<typeof page_state> & {media_failed: boolean, moved: boolean, restart: boolean, subtitle_failed: boolean, target: number}} PageChange */
/** @typedef {{type: "complete"} | {type: "failure", error: unknown} | {type: "state", state: IteratorResult<PageChange, void>}} PlaybackSelection */

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
const retry_delay = (signal) =>
  select(signal, (s) => once(AbortSignal.timeout(RETRY_DELAY), s, "abort"))

/** @param {AbortSignal} signal */
const wait_for_abort = (signal) => select(signal)

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
const set_position = (value) => {
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

const page_state = () => ({
  ended: media.ended,
  error: media.error,
  paused: media.paused,
  ready: media.readyState,
  seeking: media.seeking,
  subtitle_error: subtitle !== null && subtitle.readyState === subtitle.ERROR,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} position @returns {AsyncGenerator<PageChange, void, void>} */
const page_states = (signal, buffer, position) => {
  let changed = Promise.withResolvers()
  let previous = page_state()
  /** @type {number | undefined} */
  let requested_position = position
  let requested_position_applied = false
  let target = position

  const wake = () => changed.resolve(true)

  signal.addEventListener("abort", () => changed.resolve(false), { once: true })

  for (const type of "emptied ended error loadedmetadata pause play playing seeked seeking timeupdate waiting".split(
    " ",
  )) {
    media.addEventListener(type, wake, { signal })
  }
  for (const type of "error load".split(" ")) {
    subtitle?.addEventListener(type, wake, { signal })
  }
  buffer.changes.addEventListener("change", wake, { signal })
  if (subtitle) {
    subtitle.src = source_url(subtitle, position)
  }
  wake()

  return (async function* () {
    for (;;) {
      if (!(await changed.promise)) {
        return
      }
      changed = Promise.withResolvers()

      let current = page_state()
      let moved =
        Number.isFinite(current.time) &&
        (current.time !== previous.time || current.seeking !== previous.seeking)
      const internal_seek =
        requested_position !== undefined &&
        requested_position_applied &&
        Math.abs(current.time - requested_position) <= POSITION_TOLERANCE
      const user_seek = current.seeking && moved && !internal_seek
      let restart = false

      if (user_seek) {
        target = playable_position(current.time)
        const available = buffer.available(target)
        if (available !== undefined) {
          target = available
        }
        const positioned = Math.abs(current.time - target) <= POSITION_TOLERANCE
        restart = available === undefined
        requested_position = restart || !positioned ? target : undefined
        requested_position_applied = positioned
        set_position(target)
        if (restart && subtitle) {
          subtitle.src = source_url(subtitle, target)
        }
      } else if (requested_position !== undefined) {
        const available = buffer.available(requested_position)
        if (available !== undefined && available !== requested_position) {
          requested_position = available
          target = available
        }
        if (
          available !== undefined &&
          !requested_position_applied &&
          !media.seeking &&
          Math.abs(media.currentTime - requested_position) > POSITION_TOLERANCE
        ) {
          requested_position_applied = true
          media.currentTime = requested_position
        } else if (
          available !== undefined &&
          Math.abs(media.currentTime - requested_position) <=
            POSITION_TOLERANCE &&
          !media.seeking
        ) {
          requested_position = undefined
        }
        current = page_state()
        moved =
          Number.isFinite(current.time) &&
          (current.time !== previous.time ||
            current.seeking !== previous.seeking)
      }

      if (current.ended && !previous.ended) {
        set_position(0)
      } else if (
        !user_seek &&
        requested_position === undefined &&
        moved &&
        buffer.contains(current.time)
      ) {
        set_position(current.time)
      }

      yield {
        ...current,
        media_failed:
          current.error !== previous.error &&
          current.error !== null &&
          current.error.code !== MediaError.MEDIA_ERR_ABORTED,
        moved,
        restart,
        subtitle_failed: current.subtitle_error && !previous.subtitle_error,
        target,
      }
      previous = current
    }
  })()
}

/** @param {AbortSignal} signal @param {HTMLMediaElement} media @param {number} position @returns {Mse} */
const mse = (signal, media, position) => {
  const { ManagedMediaSource } =
    /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
      globalThis
    )
  const source = new (ManagedMediaSource ?? MediaSource)()
  const changes = new EventTarget()
  /** @type {SourceBuffer | undefined} */
  let buffer = undefined
  /** @type {SourceBuffer | undefined} */
  let current_buffer = undefined

  /** @param {SourceBuffer} current */
  const attached = (current) =>
    !signal.aborted && source.readyState !== "closed" && buffer === current

  /** @param {SourceBuffer} current */
  const writable = (current) =>
    attached(current) && source.readyState === "open"

  /** @param {number} position */
  const frontier = (position) => {
    const current = buffer
    if (current === undefined || source.readyState === "closed") {
      return undefined
    }
    const ranges = current.buffered
    for (let index = 0; index < ranges.length; index += 1) {
      if (
        ranges.start(index) - POSITION_TOLERANCE <= position &&
        position < ranges.end(index) + POSITION_TOLERANCE
      ) {
        return ranges.end(index)
      }
    }
    return undefined
  }

  /** @param {number} position */
  const available = (position) => {
    const current = buffer
    if (current === undefined || source.readyState === "closed") {
      return undefined
    }
    const ranges = current.buffered
    for (let index = 0; index < ranges.length; index += 1) {
      const start = ranges.start(index)
      const end = ranges.end(index)
      if (start <= position && position < end) {
        return position
      }
      if (position < start && start - position <= POSITION_TOLERANCE) {
        return start
      }
    }
    return undefined
  }

  /** @param {number} position */
  const contains = (position) => {
    const current = buffer
    if (current === undefined || source.readyState === "closed") {
      return false
    }
    const ranges = current.buffered
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) <= position && position < ranges.end(index)) {
        return true
      }
    }
    return false
  }

  /** @param {SourceBuffer} current @param {() => void} mutate */
  const update = async (current, mutate) => {
    if (!writable(current)) {
      return false
    }
    const settled = select(
      signal,
      (s) => once(current, s, "updateend"),
      (s) => once(current, s, "error"),
    )
    mutate()
    return Boolean(await settled)
  }

  /** @param {SourceBuffer} current */
  const reopen = async (current) => {
    if (!attached(current) || current.updating) {
      return false
    }
    if (source.readyState === "open") {
      return true
    }
    const ranges = current.buffered
    const start = ranges.length ? ranges.end(ranges.length - 1) : 0
    const settled = select(
      signal,
      (s) => once(current, s, "updateend"),
      (s) => once(current, s, "error"),
    )
    current.remove(start, start + 0.001)
    return Boolean(await settled) && writable(current)
  }

  /** @returns {AsyncGenerator<void, void, MseOperation | undefined>} */
  const operations = async function* () {
    const type = /** @type {string} */ (media.dataset.mseType)
    const duration = Number(media.dataset.duration)
    const opened = select(
      signal,
      (s) => once(source, s, "sourceopen"),
      (s) => once(source, s, "sourceclose"),
    )
    const url = URL.createObjectURL(source)
    media.src = url
    media.currentTime = position

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
      const opened_buffer = source.addSourceBuffer(type)
      current_buffer = opened_buffer
      buffer = opened_buffer

      for (
        let operation = yield undefined;
        operation !== undefined;
        operation = yield undefined
      ) {
        if (!attached(opened_buffer)) {
          return
        }
        if (typeof operation === "number") {
          if (!(await reopen(opened_buffer))) {
            return
          }
          opened_buffer.timestampOffset = operation
          continue
        }
        if (!writable(opened_buffer)) {
          return
        }

        const [position, bytes] = operation
        const end = position - BUFFER.BEHIND
        const expired =
          end > 0 &&
          opened_buffer.buffered.length &&
          opened_buffer.buffered.start(0) < end
        if (
          expired &&
          !(await update(opened_buffer, () => opened_buffer.remove(0, end)))
        ) {
          return
        }
        if (
          !(await update(opened_buffer, () =>
            opened_buffer.appendBuffer(
              /** @type {Uint8Array<ArrayBuffer>} */ (bytes),
            ),
          ))
        ) {
          return
        }
        changes.dispatchEvent(new Event("change"))
      }
    } finally {
      const current = current_buffer
      buffer = undefined
      try {
        if (
          current !== undefined &&
          source.readyState === "open" &&
          [...source.sourceBuffers].includes(current)
        ) {
          if (current.updating) {
            current.abort()
          }
          source.removeSourceBuffer(current)
        }
      } finally {
        if (media.src === url) {
          media.removeAttribute("src")
          media.load()
        }
        URL.revokeObjectURL(url)
      }
    }
    return
  }

  return Object.assign(operations(), {
    active: () => buffer !== undefined && source.readyState !== "closed",
    available,
    changes,
    contains,
    end: () => {
      const current = buffer
      if (
        current === undefined ||
        current.updating ||
        signal.aborted ||
        source.readyState !== "open"
      ) {
        return false
      }
      source.endOfStream()
      return true
    },
    frontier,
    /** @param {number} position */
    play_ahead: (position) => (frontier(position) ?? position) - position,
  })
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  const request = new AbortController()
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader = undefined

  try {
    const response = await fetch(source_url(media, time), {
      signal: AbortSignal.any([signal, request.signal]),
    })
    reader = response.body?.getReader()
    if (!response.ok || !reader) {
      throw new Error(`${response.statusText} - ${response.status}`)
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      yield value
    }
  } finally {
    try {
      await reader?.cancel()
    } finally {
      request.abort()
    }
  }
  return
}

/** @param {AbortSignal} signal @param {Mse} buffer */
const wait_for_demand = async (signal, buffer) => {
  while (buffer.play_ahead(media.currentTime) >= BUFFER.LO) {
    if (!(await select(signal, (s) => once(media, s, "timeupdate")))) {
      return false
    }
  }
  return true
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} time */
const session = async (signal, buffer, time) => {
  let start = stream_position(time)
  let playable = false

  streaming: for (;;) {
    if (!(await wait_for_demand(signal, buffer))) {
      return
    }

    if ((await buffer.next(start)).done) {
      return
    }
    try {
      for await (const bytes of source_stream(signal, start)) {
        if ((await buffer.next([media.currentTime, bytes])).done) {
          return
        }
        playable ||= buffer.available(time) !== undefined
        if (buffer.play_ahead(media.currentTime) >= BUFFER.HI) {
          start = stream_position(buffer.frontier(media.currentTime) ?? start)
          continue streaming
        }
      }
    } catch (error) {
      if (signal.aborted) {
        return
      }
      const next = stream_position(buffer.frontier(media.currentTime) ?? start)
      if (next <= start) {
        throw error
      }
      start = next
      if (!(await retry_delay(signal))) {
        return
      }
      continue streaming
    }
    if (!playable) {
      throw new Error(`stream ended before position ${time} became playable`)
    }
    const duration = Number(media.dataset.duration)
    const tail = buffer.frontier(media.currentTime)
    if (
      duration > 0 &&
      (tail === undefined || tail < duration - END_TOLERANCE)
    ) {
      if (tail === undefined || !(await retry_delay(signal))) {
        return
      }
      start = stream_position(tail)
      continue streaming
    }
    if (buffer.end()) {
      await wait_for_abort(signal)
    }
    return
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  for (;;) {
    const lifetime = new AbortController()
    const lifetime_signal = AbortSignal.any([signal, lifetime.signal])

    let target = playable_position(Number(time_input.value))
    const buffer = mse(lifetime_signal, media, target)
    try {
      if ((await buffer.next()).done) {
        return
      }
      const states = page_states(lifetime_signal, buffer, target)
      let change = states.next()

      sessions: for (;;) {
        const attempt = new AbortController()
        const attempt_signal = AbortSignal.any([
          lifetime_signal,
          attempt.signal,
        ])
        const current = session(attempt_signal, buffer, target)
        const completed = current.then(
          () => /** @type {PlaybackSelection} */ ({ type: "complete" }),
          (error) =>
            /** @type {PlaybackSelection} */ ({ type: "failure", error }),
        )
        let immediate = false

        try {
          for (;;) {
            const selected = /** @type {PlaybackSelection | undefined} */ (
              await select(
                attempt_signal,
                async () =>
                  /** @type {PlaybackSelection} */ ({
                    type: "state",
                    state: await change,
                  }),
                async () => await completed,
              )
            )
            if (!selected) {
              return
            }
            if (selected.type === "failure") {
              throw selected.error
            }
            if (selected.type === "complete") {
              break
            }
            const { state } = selected
            if (state.done) {
              return
            }
            change = states.next()

            const value = state.value
            if (value.media_failed || !buffer.active()) {
              break sessions
            }
            if (value.restart) {
              target = value.target
              immediate = true
              break
            }
          }
        } catch (error) {
          console.error(error)
        } finally {
          attempt.abort()
          await completed
        }

        if (!buffer.active()) {
          break
        }
        if (!immediate && !(await retry_delay(lifetime_signal))) {
          return
        }
      }
    } catch (error) {
      console.error(error)
    } finally {
      lifetime.abort()
      await buffer.return()
    }

    if (!(await retry_delay(signal))) {
      return
    }
  }
}

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
  set_position(initial_position)
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
})().catch(console.error)

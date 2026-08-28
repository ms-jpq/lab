/** @typedef {number | readonly [position: number, bytes: Uint8Array]} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined> & {active: () => boolean, contains: (position: number) => boolean, frontier: (position: number) => number | undefined, play_ahead: (position: number) => number}} Mse */
/** @typedef {ReturnType<typeof page_state> & {failed: boolean, moved: boolean}} PageChange */
/** @typedef {{type: "complete"} | {type: "failure", error: unknown} | {type: "state", state: IteratorResult<PageChange, void>}} PlaybackSelection */

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
  source.searchParams.set("t", String(Math.floor(time)))
  source.searchParams.set("page", PAGE)
  source.searchParams.set("request", crypto.randomUUID())
  return source.toString()
}

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
  error: media.error,
  seeking: media.seeking,
  subtitle_error: subtitle !== null && subtitle.readyState === subtitle.ERROR,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @returns {AsyncGenerator<PageChange, void, void>} */
const page_states = (signal) => {
  let changed = Promise.withResolvers()
  let previous = page_state()

  const wake = () => changed.resolve(true)

  signal.addEventListener("abort", () => changed.resolve(false), { once: true })

  for (const type of "error seeking".split(" ")) {
    media.addEventListener(type, wake, { signal })
  }
  for (const type of "error load".split(" ")) {
    subtitle?.addEventListener(type, wake, { signal })
  }
  wake()

  return (async function* () {
    for (;;) {
      if (!(await changed.promise)) {
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

/** @param {AbortSignal} signal @param {HTMLMediaElement} media @returns {Mse} */
const mse = (signal, media) => {
  const { ManagedMediaSource } =
    /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
      globalThis
    )
  const source = new (ManagedMediaSource ?? MediaSource)()
  /** @type {SourceBuffer | undefined} */
  let buffer = undefined

  /** @param {SourceBuffer} current */
  const writable = (current) =>
    !signal.aborted && source.readyState === "open" && buffer === current

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
  const contains = (position) => frontier(position) !== undefined

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
      const current_buffer = source.addSourceBuffer(type)
      buffer = current_buffer

      for (
        let operation = yield undefined;
        operation !== undefined;
        operation = yield undefined
      ) {
        if (!writable(current_buffer)) {
          return
        }
        if (typeof operation === "number") {
          current_buffer.timestampOffset = operation
          continue
        }

        const [position, bytes] = operation
        const end = position - BUFFER.BEHIND
        const expired =
          end > 0 &&
          current_buffer.buffered.length &&
          current_buffer.buffered.start(0) < end
        if (
          expired &&
          !(await update(current_buffer, () => current_buffer.remove(0, end)))
        ) {
          return
        }
        if (
          !(await update(current_buffer, () =>
            current_buffer.appendBuffer(bytes),
          ))
        ) {
          return
        }
      }
    } finally {
      buffer = undefined
      URL.revokeObjectURL(url)
    }
    return
  }

  return Object.assign(operations(), {
    active: () => buffer !== undefined && source.readyState !== "closed",
    contains,
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
  /** @type {number | undefined} */
  let position = time
  let start = time

  streaming: for (;;) {
    if (!(await wait_for_demand(signal, buffer))) {
      return
    }

    if ((await buffer.next(start)).done) {
      return
    }
    if (subtitle) {
      subtitle.src = source_url(subtitle, time)
    }
    for await (const bytes of source_stream(signal, start)) {
      if ((await buffer.next([media.currentTime, bytes])).done) {
        return
      }
      if (position !== undefined && buffer.contains(position)) {
        const target = position
        position = undefined
        if (Math.abs(media.currentTime - target) > POSITION_TOLERANCE) {
          media.currentTime = target
        }
      }
      if (buffer.play_ahead(media.currentTime) >= BUFFER.HI) {
        start = buffer.frontier(media.currentTime) ?? start
        continue streaming
      }
    }
    await wait_for_abort(signal)
    return
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  const states = page_states(signal)
  let change = states.next()

  for (;;) {
    const lifetime = new AbortController()
    const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
    const buffer = mse(lifetime_signal, media)
    try {
      if ((await buffer.next()).done) {
        return
      }

      sessions: for (;;) {
        const attempt = new AbortController()
        const attempt_signal = AbortSignal.any([
          lifetime_signal,
          attempt.signal,
        ])
        const current = session(
          attempt_signal,
          buffer,
          Number(time_input.value),
        )
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
            if (value.moved && buffer.contains(value.time)) {
              set_position(value.time)
            }
            if (value.failed || !buffer.active()) {
              break sessions
            }
            if (
              value.moved &&
              value.seeking &&
              buffer.contains(Number(time_input.value)) &&
              !buffer.contains(value.time)
            ) {
              set_position(value.time)
              immediate = true
              break
            }
          }
        } catch (error) {
          console.error(error)
          break sessions
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

media.ontimeupdate = () => set_position(media.currentTime)

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

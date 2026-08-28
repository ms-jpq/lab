/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined>} Mse */
/** @typedef {{failed: boolean, seek: number | undefined}} PageChange */
/** @typedef {readonly [AsyncIterator<unknown, void, void>, IteratorResult<unknown, void>]} IteratorSelection */
/** @typedef {{buffer: Mse, position: number, signal: AbortSignal}} PlaybackSource */

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
  return range.start - position <= POSITION_TOLERANCE
    ? range.start
    : undefined
}

/** @param {number} position */
const contains = (position) => available(position) === position

/** @param {number} position */
const play_ahead = (position) => {
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
  seeking: media.seeking,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @param {number} position @returns {AsyncGenerator<PageChange, void, void>} */
const page_states = (signal, position) => {
  const observation = new AbortController()
  const observation_signal = AbortSignal.any([signal, observation.signal])
  let changed = Promise.withResolvers()
  let previous = page_state()
  /** @type {number | undefined} */
  let requested_position = position
  let target = position

  const wake = () => changed.resolve(true)

  observation_signal.addEventListener("abort", () => changed.resolve(false), {
    once: true,
  })

  for (const type of "canplay ended error loadedmetadata progress seeked seeking timeupdate".split(
    " ",
  )) {
    media.addEventListener(type, wake, { signal: observation_signal })
  }
  if (subtitle && subtitle.src === "") {
    subtitle.src = source_url(subtitle, 0)
  }
  wake()

  return (async function* () {
    try {
      for (;;) {
        if (!(await changed.promise)) {
          return
        }
        changed = Promise.withResolvers()

        let current = page_state()
        let moved =
          Number.isFinite(current.time) &&
          (current.time !== previous.time ||
            current.seeking !== previous.seeking)
        const internal_seek =
          requested_position !== undefined &&
          Math.abs(current.time - requested_position) <= POSITION_TOLERANCE
        const user_seek = current.seeking && moved && !internal_seek
        let restart = false

        if (user_seek) {
          target = playable_position(current.time)
          const playable = available(target)
          if (playable !== undefined) {
            target = playable
          }
          const positioned =
            Math.abs(current.time - target) <= POSITION_TOLERANCE
          restart = playable === undefined
          requested_position = restart || !positioned ? target : undefined
          set_position(target)
        } else if (requested_position !== undefined) {
          const playable = available(requested_position)
          if (playable !== undefined && playable !== requested_position) {
            requested_position = playable
            target = playable
          }
          if (
            playable !== undefined &&
            !media.seeking &&
            Math.abs(media.currentTime - requested_position) >
              POSITION_TOLERANCE
          ) {
            media.currentTime = requested_position
          } else if (
            playable !== undefined &&
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
          contains(current.time)
        ) {
          set_position(current.time)
        }

        yield {
          failed:
            current.error !== previous.error &&
            current.error !== null &&
            current.error.code !== MediaError.MEDIA_ERR_ABORTED,
          seek: restart ? target : undefined,
        }
        previous = current
      }
    } finally {
      observation.abort()
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

      /** @param {() => void} mutate */
      const update = async (mutate) => {
        if (signal.aborted) {
          return false
        }
        const settled = new AbortController()
        try {
          mutate()
          await Promise.race([
            once(opened_buffer, settled.signal, "updateend"),
            once(opened_buffer, settled.signal, "error"),
          ])
          return true
        } finally {
          settled.abort()
        }
      }

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
              const ranges = opened_buffer.buffered
              const end = ranges.length ? ranges.end(ranges.length - 1) : 0
              if (!(await update(() => opened_buffer.remove(end, end + 0.001)))) {
                return
              }
            }
            opened_buffer.abort()
          }
          opened_buffer.timestampOffset = operation
          started = true
          continue
        }

        const expired = media.currentTime - BUFFER.BEHIND
        const ranges = opened_buffer.buffered
        if (
          expired > 0 &&
          ranges.length &&
          ranges.start(0) < expired &&
          !(await update(() => opened_buffer.remove(0, expired)))
        ) {
          return
        }
        if (
          !(await update(() =>
            opened_buffer.appendBuffer(
              /** @type {Uint8Array<ArrayBuffer>} */ (operation),
            ),
          ))
        ) {
          return
        }
      }
    } finally {
      media.removeAttribute("src")
      media.load()
      URL.revokeObjectURL(url)
    }
    return
  }

  return operations()
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  try {
    const response = await fetch(source_url(media, time), { signal })
    if (!response.ok || !response.body) {
      throw new Error(`${response.statusText} - ${response.status}`)
    }
    yield* response.body
  } catch (error) {
    if (!signal.aborted) {
      throw error
    }
  }
  return
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} time @returns {AsyncGenerator<void, void, void>} */
const session = async function* (signal, buffer, time) {
  const start = stream_position(time)

  while (play_ahead(media.currentTime) >= BUFFER.LO) {
    yield undefined
  }
  if ((await buffer.next(start)).done) {
    return
  }
  for await (const bytes of source_stream(signal, start)) {
    if ((await buffer.next(bytes)).done) {
      return
    }
    if (play_ahead(media.currentTime) >= BUFFER.HI) {
      do {
        yield undefined
      } while (play_ahead(media.currentTime) >= BUFFER.LO)
    }
  }
  if (!signal.aborted && !(await buffer.next("end")).done) {
    await select(signal)
  }
  return
}

/** @param {AbortSignal} signal @returns {AsyncGenerator<PlaybackSource, void, void>} */
const media_sources = async function* (signal) {
  for (;;) {
    const lifetime = new AbortController()
    const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
    const position = playable_position(Number(time_input.value))
    const buffer = mse(lifetime_signal, media, position)
    let retry = false

    try {
      if ((await buffer.next()).done) {
        return
      }
      yield { buffer, position, signal: lifetime_signal }
      retry = await retry_delay(signal)
    } catch (error) {
      if (!lifetime_signal.aborted) {
        console.error(error)
      }
      retry = await retry_delay(signal)
    } finally {
      lifetime.abort()
      await buffer.return()
    }

    if (!retry) {
      return
    }
  }
}

/** @param {PlaybackSource} source */
const play_source = async (source) => {
  const { buffer, position, signal } = source
  const states = page_states(signal, position)
  let change = states.next()
  let target = position

  for (;;) {
    const attempt = new AbortController()
    const attempt_signal = AbortSignal.any([signal, attempt.signal])
    const current = session(attempt_signal, buffer, target)
    /** @type {Promise<IteratorResult<void, void>> | undefined} */
    let progress = current.next()
    let retry = false

    try {
      for (;;) {
        const selected = /** @type {IteratorSelection | undefined} */ (
          await select(
            attempt_signal,
            async () =>
              /** @type {IteratorSelection} */ ([states, await change]),
            progress
              ? async () =>
                  /** @type {IteratorSelection} */ ([
                    current,
                    await progress,
                  ])
              : undefined,
          )
        )
        if (!selected) {
          return
        }
        const [selected_source, result] = selected
        if (selected_source === current) {
          progress = undefined
          if (result.done) {
            return
          }
          continue
        }

        const state = /** @type {IteratorResult<PageChange, void>} */ (result)
        if (state.done || state.value.failed) {
          return
        }
        change = states.next()
        if (state.value.seek !== undefined) {
          target = state.value.seek
          break
        }
        if (progress === undefined) {
          progress = current.next()
        }
      }
    } catch (error) {
      if (!attempt_signal.aborted) {
        console.error(error)
        retry = true
      }
    } finally {
      attempt.abort()
      await current.return()
    }

    if (signal.aborted) {
      return
    }
    if (retry && !(await retry_delay(signal))) {
      return
    }
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  for await (const source of media_sources(signal)) {
    try {
      await play_source(source)
    } catch (error) {
      if (!source.signal.aborted) {
        console.error(error)
      }
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

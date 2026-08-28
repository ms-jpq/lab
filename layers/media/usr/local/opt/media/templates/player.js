/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation>} Mse */
/** @typedef {{error: (error: unknown) => void, escaped: () => boolean, progress: () => void}} Diagnostics */
/** @typedef {{position: number, restart: boolean, started: boolean}} Target */
/** @template T @typedef {{error: unknown} | {result: IteratorResult<T, void>}} Selection */
/** @typedef {{close: () => Promise<void>, next: <T>(work?: Promise<T>) => Promise<typeof PULSE | T | undefined>, seek: () => void, take_error: () => unknown, target: Target}} PageReader */

const PULSE = Symbol()
const SOURCE = Symbol()
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
const MediaSourceConstructor =
  /** @type {typeof globalThis & {ManagedMediaSource?: typeof MediaSource}} */ (
    globalThis
  ).ManagedMediaSource ?? MediaSource

/** @param {EventTarget} target @param {AbortSignal} signal @param {...string} types */
const first_event = (target, signal, ...types) => {
  const { promise, resolve } = Promise.withResolvers()
  /** @param {Event} [event] */
  const close = (event) => {
    signal.removeEventListener("abort", cancelled)
    for (const type of types) {
      target.removeEventListener(type, observe)
    }
    resolve(event)
  }
  const observe = /** @param {Event} event */ (event) => close(event)
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

/** @param {AbortSignal} signal @param {number} milliseconds */
const delay = (signal, milliseconds) => {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  const { promise, resolve } = Promise.withResolvers()
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

/** @param {string | undefined} url */
const revoke_url = (url) => url && URL.revokeObjectURL(url)

/** @returns {Diagnostics} */
const diagnostics = () => {
  let failed = false
  let escaped = false
  return {
    error: (error) => {
      if (failed) {
        return
      }
      failed = true
      try {
        console.error(error)
      } catch (error) {
        escaped = true
        throw error
      }
    },
    escaped: () => escaped,
    progress: () => {
      escaped = false
      failed = false
    },
  }
}

/** @param {HTMLMediaElement | HTMLTrackElement} resource @param {number} time */
const source_url = (resource, time) => {
  const path = /** @type {string} */ (resource.dataset.src)
  const source = new URL(path, location.href)
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

/** @param {number} left @param {number} right */
const aligned = (left, right) => Math.abs(left - right) <= POSITION_TOLERANCE

/** @param {number} position @param {boolean} inclusive */
const buffered_range = (position, inclusive) => {
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

/** @param {number} position */
const buffered_position = (position) => {
  const range = buffered_range(position, false)
  return range ? Math.max(position, range.at(0) ?? -Infinity) : undefined
}

/** @param {number} position */
const buffered_end = (position) => buffered_range(position, true)?.at(1)

/** @param {number} frontier */
const play_ahead = (frontier) => {
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

const media_observation = () => ({
  ended: media.ended,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

/** @param {AbortSignal} signal @param {(event: Event) => void} observe */
const observe_media = (signal, observe) => {
  for (const type of MEDIA_EVENTS) {
    media.addEventListener(type, observe, { signal })
  }
}

/** @template T @param {AsyncIterator<T, void, void>} source */
const selector = (source) => {
  /** @type {Selection<T> | undefined} */
  let available = undefined
  /** @type {((value: unknown) => void) | undefined} */
  let notify = undefined
  /** @param {Selection<T>} selection */
  const settle = (selection) => {
    available = selection
    notify?.(SOURCE)
  }
  const advance = () =>
    source.next().then(
      (result) => settle({ result }),
      (error) => settle({ error }),
    )
  advance()

  /** @template W @param {Promise<W>} [work] @returns {Promise<T | W | undefined>} */
  return async (work) => {
    if (!available) {
      const selected = await new Promise((resolve, reject) => {
        /** @param {unknown} value */
        const awaken = (value) => {
          if (notify === awaken) {
            notify = undefined
            resolve(value)
          }
        }
        notify = awaken
        work?.then(awaken, reject)
      })
      if (selected !== SOURCE) {
        return /** @type {W} */ (selected)
      }
    }
    const selection = /** @type {Selection<T>} */ (available)
    if ("error" in selection) {
      throw selection.error
    }
    if (selection.result.done) {
      return undefined
    }
    available = undefined
    advance()
    return selection.result.value
  }
}

/** @param {AbortSignal} signal @param {number} position @returns {PageReader} */
const page_reader = (signal, position) => {
  const lifetime = new AbortController()
  const page_signal = AbortSignal.any([signal, lifetime.signal])
  let target = { position, restart: false, started: false }
  /** @type {Target | undefined} */
  let positioning = target
  /** @type {unknown | undefined} */
  let failure = undefined
  let current = media_observation()
  let previous = current
  let changed = Promise.withResolvers()
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
  /** @param {Event} event */
  const observe = (event) => {
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

  const pulses = /** @type {AsyncGenerator<typeof PULSE, void, void>} */ (
    (async function* () {
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
    })()
  )
  const next = selector(pulses)
  return {
    close: async () => {
      lifetime.abort()
      await pulses.return()
    },
    next,
    get target() {
      return target
    },
    seek,
    take_error,
  }
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {SourceBuffer} buffer @returns {Mse} */
const mse = async function* (signal, source, buffer) {
  /** @param {() => void} mutate */
  const update = async (mutate) => {
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
      buffer.appendBuffer(/** @type {Uint8Array<ArrayBuffer>} */ (operation)),
    )
  }
}

/** @param {AbortController} request @param {number} time @returns {AsyncGenerator<Uint8Array, {error: unknown} | void, void>} */
const request_stream = async function* (request, time) {
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader = undefined
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
}

/** @param {AbortSignal} signal */
const play_subtitle = async (signal) => {
  if (!subtitle) {
    return
  }
  const failures = diagnostics()
  for (;;) {
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

/** @param {PageReader} page @param {() => boolean} interrupted */
const retry_when = async (page, interrupted) => {
  const timer = new AbortController()
  const deadline = delay(timer.signal, RETRY_DELAY)
  try {
    for (;;) {
      const change = await page.next(deadline)
      if (change === undefined) {
        return false
      }
      if (change !== PULSE || interrupted()) {
        return true
      }
    }
  } finally {
    timer.abort()
  }
}

/** @param {Diagnostics} failures @param {PageReader} page @returns {AsyncGenerator<MseOperation, void, void>} */
const source_stream = async function* (failures, page) {
  let target = page.target
  let start = target.position
  /** @param {number} frontier */
  const retarget = (frontier) => {
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

  acquisition: for (;;) {
    retarget(start)

    while (play_ahead(start) >= BUFFER.LO) {
      const change = await page.next()
      if (change === undefined) {
        return
      }
      if (retarget(start)) {
        continue acquisition
      }
    }
    const request = new AbortController()
    const stream = request_stream(request, start)
    let frontier = stream_position(start)

    try {
      yield frontier
      if (retarget(frontier)) {
        continue acquisition
      }

      reading: for (;;) {
        const read = stream.next()
        let change = await page.next(read)
        while (change === PULSE) {
          if (retarget(frontier)) {
            continue acquisition
          }
          change = await page.next(read)
        }
        if (change === undefined) {
          return
        }

        const next = change
        if (next.done) {
          if (!next.value) {
            yield "end"
            for (;;) {
              const idle = await page.next()
              if (idle === undefined) {
                return
              }
              if (retarget(frontier)) {
                continue acquisition
              }
            }
          }
          failures.error(next.value.error)
          start = stream_position(buffered_end(frontier) ?? frontier)
          break reading
        }
        yield next.value
        const next_frontier = stream_position(
          buffered_end(frontier) ?? frontier,
        )
        if (next_frontier > frontier) {
          failures.progress()
        }
        frontier = next_frontier
        if (retarget(frontier)) {
          continue acquisition
        }
        if (play_ahead(frontier) >= BUFFER.HI) {
          start = frontier
          continue acquisition
        }
      }
    } finally {
      request.abort()
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

/** @param {Mse} buffer @param {Diagnostics} failures @param {PageReader} page */
const play_source = async (buffer, failures, page) => {
  for await (const operation of source_stream(failures, page)) {
    if ((await buffer.next(operation)).done) {
      return
    }
  }
}

const media_sources = () => {
  /** @type {string | undefined} */
  let url = undefined
  return {
    close: () => {
      media.removeAttribute("src")
      media.load()
      revoke_url(url)
    },
    /** @param {AbortSignal} signal @param {PageReader} page */
    open: async (signal, page) => {
      const source = new MediaSourceConstructor()
      const opening = new AbortController()
      const opened = first_event(
        source,
        AbortSignal.any([signal, opening.signal]),
        "sourceopen",
        "sourceclose",
      )
      const previous = url
      const next = URL.createObjectURL(source)
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
        const duration = Number(media.dataset.duration)
        if (duration > 0) {
          source.duration = duration
        }
        const buffer = mse(
          signal,
          source,
          source.addSourceBuffer(
            /** @type {string} */ (media.dataset.mseType),
          ),
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

/** @param {AbortSignal} signal @param {ReturnType<typeof media_sources>} sources @param {Diagnostics} failures @param {PageReader} page */
const play_attempt = async (signal, sources, failures, page) => {
  /** @type {Mse | undefined} */
  let buffer = undefined
  try {
    buffer = await sources.open(signal, page)
    if (!buffer) {
      return undefined
    }
    await play_source(buffer, failures, page)
    return undefined
  } catch (error) {
    if (failures.escaped()) {
      throw error
    }
    return signal.aborted
      ? undefined
      : {
          failure: buffer ? (page.take_error() ?? error) : error,
          opened: buffer !== undefined,
        }
  } finally {
    await buffer?.return()
  }
}

/** @param {AbortSignal} signal */
const play_media = async (signal) => {
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
    sources.close()
    await page.close()
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
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

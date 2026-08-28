/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation>} Mse */
/** @typedef {{fail: (error: unknown) => void, recover: () => void}} FailureStorm */
/** @typedef {{position: number, restart: boolean, started: boolean}} Target */
/** @template T @typedef {{error: unknown} | {result: IteratorResult<T, void>}} Selection */
/** @typedef {{close: () => Promise<void>, next: <T>(work?: Promise<T>) => Promise<typeof PULSE | T | undefined>, seek: () => void, take_error: () => unknown, target: Target}} PageReader */
/** @typedef {ReturnType<typeof media_observation>} MediaObservation */
/** @typedef {{current: MediaObservation, failure: unknown | undefined, handled: Target, positioning: Target | undefined, previous: MediaObservation, target: Target}} PageState */

const PULSE = Symbol()
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
  if (signal.aborted) {
    cancelled()
  }
  return promise
}

/** @param {string | undefined} url */
const revoke_url = (url) => url && URL.revokeObjectURL(url)

/** @returns {FailureStorm} */
const failure_storm = () => {
  let failed = false
  return {
    fail: (error) => {
      if (failed) {
        return
      }
      failed = true
      console.error(error)
    },
    recover: () => (failed = false),
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

/** @template T @param {AsyncIterator<T, void, void>} source */
const selector = (source) => {
  const advance = () =>
    source.next().then(
      (result) => ({ result }),
      (error) => ({ error }),
    )
  let pending = advance()

  /** @template W @param {Promise<W>} [work] @returns {Promise<T | W | undefined>} */
  return async (work) => {
    const selected = await (work === undefined
      ? pending
      : Promise.race([pending, work.then((value) => ({ value }))]))
    if ("value" in selected) {
      return selected.value
    }
    if ("error" in selected) {
      throw selected.error
    }
    if (selected.result.done) {
      return undefined
    }
    pending = advance()
    return selected.result.value
  }
}

/** @param {AbortSignal} signal @param {number} position @returns {PageReader} */
const page_reader = (signal, position) => {
  const lifetime = new AbortController()
  const page_signal = AbortSignal.any([signal, lifetime.signal])
  const target = { position, restart: false, started: false }
  const current = media_observation()
  /** @type {PageState} */
  let state = {
    current,
    failure: undefined,
    handled: target,
    positioning: target,
    previous: current,
    target,
  }
  let changed = Promise.withResolvers()
  const seek = () => {
    state.target.started = false
    state = { ...state, positioning: state.target }
    media.currentTime = state.target.position
  }
  const take_error = () => {
    const error = state.failure
    state = { ...state, failure: undefined }
    return error
  }
  /** @param {Event} event */
  const observe = (event) => {
    const current = media_observation()
    const failure =
      event.type === "error" &&
      media.error?.code !== MediaError.MEDIA_ERR_ABORTED
        ? (state.failure ?? media.error)
        : state.failure
    const owned =
      state.positioning !== undefined &&
      aligned(current.time, state.positioning.position)
        ? state.positioning
        : undefined
    if ((event.type === "seeking" || event.type === "seeked") && owned) {
      owned.started = true
    }
    const next_target = (() => {
      if (!current.seeking || owned) {
        return state.target
      }
      const position = playable_position(current.time)
      return {
        position: buffered_position(position) ?? position,
        restart: false,
        started: true,
      }
    })()
    state = { ...state, current, failure, target: next_target }
    changed.resolve(true)
  }
  const cancelled = () => changed.resolve(false)
  page_signal.addEventListener("abort", cancelled, { once: true })
  for (const type of MEDIA_EVENTS) {
    media.addEventListener(type, observe)
  }

  const pulses = /** @type {AsyncGenerator<typeof PULSE, void, void>} */ (
    (async function* () {
      try {
        yield PULSE
        for (;;) {
          if (!(await changed.promise) || page_signal.aborted) {
            return
          }
          changed = Promise.withResolvers()
          if (!(await delay(page_signal, 0))) {
            return
          }
          const { current, previous, target } = state
          const moved =
            current.time !== previous.time ||
            current.seeking !== previous.seeking
          const user_seek = target !== state.handled
          let positioning = state.positioning

          if (user_seek) {
            const playable = buffered_position(target.position)
            target.position = playable ?? target.position
            target.restart = playable === undefined
            positioning =
              target.restart || !aligned(current.time, target.position)
                ? target
                : undefined
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

          state = {
            ...state,
            handled: user_seek ? target : state.handled,
            positioning,
            previous: current,
          }
          yield PULSE
        }
      } finally {
        page_signal.removeEventListener("abort", cancelled)
        for (const type of MEDIA_EVENTS) {
          media.removeEventListener(type, observe)
        }
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
      return state.target
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
const source_stream = async function* (request, time) {
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
  const failures = failure_storm()
  for (;;) {
    const loaded = first_event(subtitle, signal, "load", "error")
    subtitle.src = source_url(subtitle, 0)
    const event = await loaded
    if (!event || event.type === "load") {
      return
    }
    failures.fail(event)
    if (!(await delay(signal, RETRY_DELAY))) {
      return
    }
  }
}

/** @param {FailureStorm} failures @param {PageReader} page @returns {AsyncGenerator<MseOperation, void, void>} */
const media_operations = async function* (failures, page) {
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
    const error = page.take_error()
    if (error !== undefined) {
      throw error
    }
    if (page.target !== target) {
      target = page.target
      start = target.position
    }

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
    const stream = source_stream(request, start)
    let frontier = stream_position(start)

    try {
      yield frontier
      if (retarget(frontier)) {
        continue acquisition
      }

      reading: for (;;) {
        const read = stream.next()
        for (;;) {
          const change = await page.next(read)
          if (change === PULSE) {
            if (retarget(frontier)) {
              continue acquisition
            }
            continue
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
            failures.fail(next.value.error)
            start = stream_position(buffered_end(frontier) ?? frontier)
            break reading
          }
          yield next.value
          const next_frontier = stream_position(
            buffered_end(frontier) ?? frontier,
          )
          if (next_frontier > frontier) {
            failures.recover()
          }
          frontier = next_frontier
          if (retarget(frontier)) {
            continue acquisition
          }
          if (play_ahead(frontier) >= BUFFER.HI) {
            start = frontier
            continue acquisition
          }
          break
        }
      }
    } finally {
      request.abort()
      await stream.return()
    }
    const timer = new AbortController()
    const deadline = delay(timer.signal, RETRY_DELAY)
    try {
      for (;;) {
        const change = await page.next(deadline)
        if (change !== PULSE) {
          if (!change) {
            return
          }
          break
        }
        const interrupted = page.target !== target && page.target.restart
        if (retarget(start) || interrupted) {
          start = page.target.position
          continue acquisition
        }
      }
      continue acquisition
    } finally {
      timer.abort()
    }
  }
}

/** @param {Mse} buffer @param {FailureStorm} failures @param {PageReader} page */
const play_source = async (buffer, failures, page) => {
  for await (const operation of media_operations(failures, page)) {
    if ((await buffer.next(operation)).done) {
      return
    }
  }
}

/** @param {AbortSignal} signal */
const play_media = async (signal) => {
  const page = page_reader(signal, playable_position(Number(time_input.value)))
  const failures = failure_storm()
  /** @type {string | undefined} */
  let attached_url = undefined
  try {
    for (;;) {
      const page_failure = page.take_error()
      if (page_failure !== undefined) {
        failures.fail(page_failure)
      }
      const target = page.target
      const lifetime = new AbortController()
      const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
      /** @type {Mse | undefined} */
      let buffer = undefined
      /** @type {unknown} */
      let failure
      /** @type {string | undefined} */
      let loose_url = undefined

      try {
        const source = new MediaSourceConstructor()
        const opened = first_event(
          source,
          lifetime_signal,
          "sourceopen",
          "sourceclose",
        )
        loose_url = URL.createObjectURL(source)
        media.src = loose_url
        page.seek()
        const previous_url = attached_url
        attached_url = loose_url
        loose_url = undefined
        const selected = await opened.finally(() => revoke_url(previous_url))
        if (!selected) {
          return
        }
        if (selected.type !== "sourceopen") {
          throw selected
        }
        const duration = Number(media.dataset.duration)
        if (duration > 0) {
          source.duration = duration
        }
        buffer = mse(
          lifetime_signal,
          source,
          source.addSourceBuffer(/** @type {string} */ (media.dataset.mseType)),
        )
        await buffer.next()
        await play_source(buffer, failures, page)
        return
      } catch (error) {
        if (lifetime_signal.aborted) {
          return
        }
        failure = error
      } finally {
        lifetime.abort()
        await buffer?.return()
        revoke_url(loose_url)
      }
      if (buffer) {
        failure = page.take_error() ?? failure
      }
      failures.fail(failure)
      if (!buffer) {
        const timer = new AbortController()
        const deadline = delay(timer.signal, RETRY_DELAY)
        try {
          for (;;) {
            const change = await page.next(deadline)
            if (change === undefined) {
              return
            }
            if (change !== PULSE) {
              if (!change) {
                return
              }
              break
            }
            if (
              page.take_error() !== undefined ||
              (page.target !== target && page.target.restart)
            ) {
              break
            }
          }
        } finally {
          timer.abort()
        }
      }
      if (signal.aborted) {
        return
      }
    }
  } finally {
    media.removeAttribute("src")
    media.load()
    revoke_url(attached_url)
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

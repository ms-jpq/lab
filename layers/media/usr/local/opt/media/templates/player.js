/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation | undefined>} Mse */
/** @typedef {{error: unknown | null, position: number, restart: boolean}} PageChange */
/** @typedef {{fail: (error: unknown) => void, recover: () => void}} FailureStorm */
/** @typedef {{error: unknown, position: number}} SourceFailure */
/** @typedef {{error: unknown, start: number}} SessionFailure */
/** @typedef {{changes: AsyncGenerator<PageChange, void, void>, pending: Promise<IteratorResult<PageChange, void>>}} PageReader */
/** @typedef {{position: number, start: number} | SourceFailure} RetryChange */

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
const MediaSourceConstructor =
  /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
    globalThis
  ).ManagedMediaSource ?? MediaSource

/** @param {EventTarget} target @param {AbortSignal | undefined} signal @param {string} type @returns {Promise<Event>} */
const once = (target, signal, type) => {
  const { promise, resolve } = Promise.withResolvers()
  target.addEventListener(type, resolve, { once: true, signal })
  return promise
}

/** @param {AbortSignal} signal @param {EventTarget} target @param {...string} types */
const first_event = async (signal, target, ...types) => {
  if (signal.aborted) {
    return undefined
  }
  const listeners = new AbortController()
  const listener_signal = AbortSignal.any([signal, listeners.signal])
  try {
    return await Promise.race([
      ...types.map((type) => once(target, listener_signal, type)),
      once(signal, listeners.signal, "abort").then(() => undefined),
    ])
  } finally {
    listeners.abort()
  }
}

/** @param {AbortSignal} signal */
const retry_delay = (signal) => {
  if (signal.aborted) {
    return Promise.resolve(false)
  }
  const { promise, resolve } = Promise.withResolvers()
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

/** @param {string | undefined} url */
const revoke_url = (url) => url && URL.revokeObjectURL(url)

/** @returns {FailureStorm} */
const failure_storm = () => {
  let failed = false
  return {
    fail: (error) => {
      if (!failed) {
        failed = true
        report(error)
      }
    },
    recover: () => (failed = false),
  }
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
  return range ? Math.max(position, range[0]) : undefined
}

/** @param {number} position */
const buffered_end = (position) => buffered_range(position, true)?.[1]

const play_ahead = () =>
  (buffered_end(media.currentTime) ?? media.currentTime) - media.currentTime

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

/** @param {string | undefined} [type] */
const media_observation = (type) => ({
  ended: media.ended,
  error: media.error,
  future: media.readyState >= media.HAVE_FUTURE_DATA,
  metadata: media.readyState >= media.HAVE_METADATA,
  paused: media.paused,
  seeking: media.seeking,
  time: media.currentTime,
  type,
})

/** @param {AbortSignal} signal @param {number} position @returns {AsyncGenerator<PageChange, void, void>} */
const page_changes = async function* (signal, position) {
  const types =
    "canplay ended error loadedmetadata play playing progress seeked seeking timeupdate waiting".split(
      " ",
    )
  /** @type {ReturnType<typeof media_observation>[]} */
  const pending = []
  let changed = Promise.withResolvers()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scheduled = undefined

  /** @param {Event} event */
  const observe = (event) => {
    if (signal.aborted) {
      return
    }
    pending.push(media_observation(event.type))
    if (scheduled === undefined) {
      const gate = changed
      scheduled = setTimeout(() => gate.resolve(true), 0)
    }
  }
  const cancelled = () => {
    if (scheduled !== undefined) {
      clearTimeout(scheduled)
    }
    changed.resolve(false)
  }

  signal.addEventListener("abort", cancelled, { once: true })
  for (const type of types) {
    media.addEventListener(type, observe)
  }
  pending.push(media_observation())
  changed.resolve(true)
  /** @type {Promise<{played: true} | {play_error: unknown, source: string}> | undefined} */
  let playing = undefined
  let previous = media_observation()
  let established = false
  let resume = false
  /** @type {number | undefined} */
  let pending_seek = position
  let target = position

  try {
    for (;;) {
      const selected = await Promise.race([
        changed.promise.then((result) => ({ changed: result })),
        ...(playing ? [playing] : []),
      ])
      if ("play_error" in selected) {
        playing = undefined
        if (selected.source === media.src) {
          yield {
            error: selected.play_error,
            position: target,
            restart: false,
          }
          continue
        }
        resume = true
        continue
      }
      if ("played" in selected) {
        playing = undefined
        continue
      }
      if (!selected.changed || signal.aborted) {
        return
      }
      const observations = pending.splice(0)
      changed = Promise.withResolvers()
      scheduled = undefined
      /** @type {MediaError | null} */
      let error = null
      let restart = false

      for (const observed of observations) {
        const current = observed
        if (current.type === "playing") {
          established = true
        } else if (current.type === "play") {
          resume = false
        }
        if (
          established &&
          current.type === "waiting" &&
          !current.future &&
          !current.paused
        ) {
          established = false
          resume = true
          media.pause()
        } else if (
          resume &&
          current.type === "canplay" &&
          current.paused &&
          current.future
        ) {
          resume = false
          const source = media.src
          playing = media.play().then(
            () => ({ played: /** @type {const} */ (true) }),
            (play_error) => ({ play_error, source }),
          )
        }
        let moved =
          current.time !== previous.time || current.seeking !== previous.seeking
        const internal_seek =
          pending_seek !== undefined && aligned(current.time, pending_seek)
        const user_seek = current.seeking && moved && !internal_seek

        if (user_seek) {
          target = playable_position(current.time)
          const playable = buffered_position(target)
          target = playable ?? target
          restart = playable === undefined
          pending_seek =
            restart || !aligned(current.time, target) ? target : undefined
          persist_position(target)
        } else if (pending_seek !== undefined) {
          const playable = buffered_position(pending_seek)
          if (playable !== undefined) {
            target = pending_seek = playable
          }
        }

        if (current.ended && !previous.ended) {
          persist_position(0)
        } else if (
          !user_seek &&
          pending_seek === undefined &&
          moved &&
          buffered_position(current.time) === current.time
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

      const current = observations.at(-1)
      if (current && pending_seek !== undefined && !current.seeking) {
        const playable = buffered_position(pending_seek)
        if (playable !== undefined) {
          target = pending_seek = playable
        }
        const positioned = aligned(current.time, pending_seek)
        if (!positioned && (current.metadata || playable !== undefined)) {
          media.currentTime = pending_seek
        } else if (positioned && playable !== undefined) {
          pending_seek = undefined
        }
      }

      yield { error, position: target, restart }
    }
  } finally {
    if (scheduled !== undefined) {
      clearTimeout(scheduled)
    }
    signal.removeEventListener("abort", cancelled)
    for (const type of types) {
      media.removeEventListener(type, observe)
    }
    await playing
  }
}

/** @param {PageReader} page @param {IteratorResult<PageChange, void>} result */
const advance_page = (page, result) => {
  if (result.done) {
    return undefined
  }
  page.pending = page.changes.next()
  return result.value
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {SourceBuffer} buffer @returns {Mse} */
const mse = (signal, source, buffer) => {
  /** @param {() => void} mutate */
  const update = async (mutate) => {
    const operation = new AbortController()
    try {
      const settled = first_event(
        operation.signal,
        buffer,
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

  return (async function* () {
    let started = false
    for (
      let operation = yield undefined;
      operation !== undefined;
      operation = yield undefined
    ) {
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
  })()
}

/** @param {AbortSignal} signal @param {number} time @returns {AsyncGenerator<Uint8Array, {error: unknown} | void, void>} */
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
    return request_signal.aborted ? undefined : { error }
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
    const loaded = first_event(signal, subtitle, "load", "error")
    subtitle.src = source_url(subtitle, 0)
    const event = await loaded
    if (!event || event.type === "load") {
      return
    }
    failures.fail(event)
    if (!(await retry_delay(signal))) {
      return
    }
  }
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} time @param {FailureStorm} failures @returns {AsyncGenerator<void, SessionFailure | void, void>} */
const session = async function* (signal, buffer, time, failures) {
  let start = stream_position(time)

  streaming: for (;;) {
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
            return {
              error: next.value.error,
              start: stream_position(buffered_end(start) ?? start),
            }
          }
          break streaming
        }
        if ((await buffer.next(next.value)).done) {
          return
        }
        const next_start = stream_position(buffered_end(start) ?? start)
        if (next_start > start) {
          failures.recover()
        }
        start = next_start
        if (play_ahead() >= BUFFER.HI) {
          continue streaming
        }
      }
    } finally {
      await stream.return()
    }
  }
  if (signal.aborted) {
    return
  }
  if (!(await buffer.next("end")).done && !signal.aborted) {
    await once(signal, undefined, "abort")
  }
}

/** @param {AbortSignal} signal @param {PageReader} page @param {number} position @param {number} start @returns {Promise<RetryChange | undefined>} */
const wait_to_retry = async (signal, page, position, start) => {
  const timer = new AbortController()
  const delay = retry_delay(AbortSignal.any([signal, timer.signal]))
  const deadline = delay.then((result) => ({ delay: result }))
  try {
    for (;;) {
      const selected = await Promise.race([
        page.pending.then((result) => ({ page: result })),
        deadline,
      ])
      if ("delay" in selected) {
        return selected.delay ? { position, start } : undefined
      }
      const change = advance_page(page, selected.page)
      if (change === undefined) {
        return undefined
      }
      position = change.position
      if (change.error) {
        return { error: change.error, position }
      }
      if (change.restart) {
        return { position, start: position }
      }
    }
  } finally {
    timer.abort()
  }
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {FailureStorm} failures @param {PageReader} page @param {number} position @returns {Promise<SourceFailure | undefined>} */
const play_source = async (signal, buffer, failures, page, position) => {
  let start = position
  try {
    for (;;) {
      const attempt = new AbortController()
      const attempt_signal = AbortSignal.any([signal, attempt.signal])
      const current = session(attempt_signal, buffer, start, failures)
      const cancelled = attempt_signal.aborted
        ? Promise.resolve({ cancelled: true })
        : once(attempt_signal, undefined, "abort").then(() => ({
            cancelled: true,
          }))
      /** @type {Promise<IteratorResult<void, SessionFailure | void>> | undefined} */
      let progress = current.next()
      /** @type {SessionFailure | undefined} */
      let failure = undefined

      try {
        for (;;) {
          const selected = await Promise.race([
            page.pending.then((result) => ({ page: result })),
            ...(progress
              ? [progress.then((result) => ({ progress: result }))]
              : []),
            cancelled,
          ])
          if ("cancelled" in selected) {
            return undefined
          }
          if ("progress" in selected) {
            const result = selected.progress
            progress = undefined
            if (result.done) {
              if (!result.value) {
                return undefined
              }
              failure = result.value
              break
            }
            continue
          }

          const change = advance_page(page, selected.page)
          if (change === undefined) {
            return undefined
          }
          position = change.position
          if (change.error) {
            return { error: change.error, position }
          }
          if (change.restart) {
            start = position
            break
          }
          if (progress === undefined) {
            progress = current.next()
          }
        }
      } finally {
        attempt.abort()
        await current.return()
      }
      if (!failure) {
        continue
      }

      failures.fail(failure.error)
      const waiting = await wait_to_retry(signal, page, position, failure.start)
      if (waiting === undefined) {
        return undefined
      }
      if ("error" in waiting) {
        return waiting
      }
      position = waiting.position
      start = waiting.start
    }
  } catch (error) {
    return signal.aborted ? undefined : { error, position }
  }
}

/** @param {AbortSignal} signal */
const play_media = async (signal) => {
  let position = playable_position(Number(time_input.value))
  const observation = new AbortController()
  const changes = page_changes(
    AbortSignal.any([signal, observation.signal]),
    position,
  )
  const page = { changes, pending: changes.next() }
  const failures = failure_storm()
  /** @type {string | undefined} */
  let attached_url = undefined
  try {
    for (;;) {
      const lifetime = new AbortController()
      const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
      /** @type {Mse | undefined} */
      let buffer = undefined
      /** @type {SourceFailure | {setup: unknown} | undefined} */
      let failure = undefined
      /** @type {string | undefined} */
      let loose_url = undefined
      /** @type {string | undefined} */
      let previous_url = undefined

      try {
        const source = new MediaSourceConstructor()
        const opened = first_event(
          lifetime_signal,
          source,
          "sourceopen",
          "sourceclose",
        )
        loose_url = URL.createObjectURL(source)
        media.src = loose_url
        previous_url = attached_url
        attached_url = loose_url
        loose_url = undefined
        media.currentTime = position
        const selected = await opened
        revoke_url(previous_url)
        previous_url = undefined
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
        failure = await play_source(
          lifetime_signal,
          buffer,
          failures,
          page,
          position,
        )
        if (!failure) {
          return
        }
        position = failure.position
      } catch (error) {
        if (lifetime_signal.aborted) {
          return
        }
        failure = { setup: error }
      } finally {
        lifetime.abort()
        await buffer?.return()
        revoke_url(loose_url)
        revoke_url(previous_url)
      }
      if (!failure) {
        return
      }
      if ("setup" in failure) {
        failures.fail(failure.setup)
        const waiting = await wait_to_retry(signal, page, position, position)
        if (!waiting) {
          return
        }
        position = waiting.position
        if ("error" in waiting) {
          failures.fail(waiting.error)
        }
      } else {
        failures.fail(failure.error)
        if (signal.aborted) {
          return
        }
      }
    }
  } finally {
    media.removeAttribute("src")
    media.load()
    revoke_url(attached_url)
    observation.abort()
    await changes.return()
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

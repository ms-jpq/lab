/** @typedef {"end" | number | Uint8Array} MseOperation */
/** @typedef {AsyncGenerator<void, void, MseOperation>} Mse */
/** @typedef {"checkpoint" | void} SessionStep */
/** @typedef {{position: number, restart: boolean, revision: number}} PageChange */
/** @typedef {{checkpoint: boolean, frontier: number, mutating: boolean}} Acquisition */
/** @typedef {{fail: (error: unknown) => void, recover: () => void}} FailureStorm */
/** @typedef {{error: unknown}} SourceFailure */
/** @typedef {{error: unknown, start: number}} SessionFailure */
/** @typedef {{position: number, started: boolean}} Positioning */
/** @typedef {{changes: AsyncGenerator<PageChange, void, void>, pending: Promise<IteratorResult<PageChange, void>>, position: number, revision: number, seek: () => void}} PageReader */
/** @template T @typedef {{close: () => void, current: T | undefined, pending: Promise<T | undefined>}} Latch */
/** @typedef {Latch<SourceFailure>} MediaFailure */

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
  "canplay ended loadedmetadata progress seeked seeking timeupdate waiting".split(
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

/** @template T @param {EventTarget} target @param {AbortSignal | undefined} signal @param {string[]} types @param {(event: Event) => T | undefined} select @returns {Latch<T>} */
const event_latch = (target, signal, types, select) => {
  const { promise, resolve } = Promise.withResolvers()
  /** @type {T | undefined} */
  let current = undefined
  const close = () => {
    signal?.removeEventListener("abort", close)
    for (const type of types) {
      target.removeEventListener(type, observe)
    }
    resolve(current)
  }
  /** @param {Event} event */
  const observe = (event) => {
    const selected = select(event)
    if (selected !== undefined) {
      current = selected
      close()
    }
  }
  for (const type of types) {
    target.addEventListener(type, observe)
  }
  signal?.addEventListener("abort", close, { once: true })
  if (signal?.aborted) {
    close()
  }
  return {
    close,
    get current() {
      return current
    },
    pending: promise,
  }
}

/** @param {EventTarget} target @param {AbortSignal | undefined} signal @param {...string} types */
const first_event = (target, signal, ...types) =>
  event_latch(target, signal, types, (event) => event).pending

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

/** @param {AbortSignal} signal @returns {MediaFailure} */
const media_failure = (signal) =>
  event_latch(media, signal, ["error"], () => {
    const error = media.error
    return error && error.code !== MediaError.MEDIA_ERR_ABORTED
      ? { error }
      : undefined
  })

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
  return range ? Math.max(position, range[0] ?? -Infinity) : undefined
}

/** @param {number} position */
const buffered_end = (position) => buffered_range(position, true)?.[1]

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

/** @param {AbortSignal} signal @param {(event: Event, observation: ReturnType<typeof media_observation>) => void} observed */
const media_batches = async function* (signal, observed) {
  let current = media_observation()
  let changed = Promise.withResolvers()
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let scheduled = undefined
  /** @param {Event} event */
  const observe = (event) => {
    current = media_observation()
    observed(event, current)
    if (scheduled === undefined) {
      const gate = changed
      scheduled = setTimeout(() => gate.resolve(true), 0)
    }
  }
  const cancelled = () => changed.resolve(false)

  signal.addEventListener("abort", cancelled, { once: true })
  for (const type of MEDIA_EVENTS) {
    media.addEventListener(type, observe)
  }
  changed.resolve(true)
  try {
    for (;;) {
      if (!(await changed.promise) || signal.aborted) {
        return
      }
      changed = Promise.withResolvers()
      scheduled = undefined
      yield current
    }
  } finally {
    if (scheduled !== undefined) {
      clearTimeout(scheduled)
    }
    signal.removeEventListener("abort", cancelled)
    for (const type of MEDIA_EVENTS) {
      media.removeEventListener(type, observe)
    }
  }
}

/** @param {AbortSignal} signal @param {number} position @returns {PageReader} */
const page_reader = (signal, position) => {
  /** @type {Positioning | undefined} */
  let positioning = { position, started: false }
  let target = position
  let revision = 0
  const seek = () => {
    positioning = { position: target, started: false }
    media.currentTime = target
  }
  /** @param {Event} event @param {ReturnType<typeof media_observation>} current */
  const observe = (event, current) => {
    const owned =
      positioning !== undefined && aligned(current.time, positioning.position)
        ? positioning
        : undefined
    if ((event.type === "seeking" || event.type === "seeked") && owned) {
      owned.started = true
    }
    if (current.seeking && !owned) {
      const position = playable_position(current.time)
      target = buffered_position(position) ?? position
      revision += 1
    }
  }
  const changes = (async function* () {
    let previous = media_observation()
    let handled_revision = revision

    for await (const current of media_batches(signal, observe)) {
      const moved =
        current.time !== previous.time || current.seeking !== previous.seeking
      const user_seek = revision > handled_revision
      let restart = false

      if (user_seek) {
        const playable = buffered_position(target)
        target = playable ?? target
        restart = playable === undefined
        positioning =
          restart || !aligned(current.time, target)
            ? { position: target, started: true }
            : undefined
        handled_revision = revision
        persist_position(target)
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
          target = playable
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
      yield { position: target, restart, revision }
    }
  })()
  return {
    changes,
    pending: changes.next(),
    get position() {
      return target
    },
    get revision() {
      return revision
    },
    seek,
  }
}

/** @template T @param {PageReader} page @param {MediaFailure} failure @param {Promise<T> | undefined} work @returns {Promise<PageChange | SourceFailure | {value: T} | undefined>} */
const source_change = async (page, failure, work) => {
  const selected = await Promise.race([
    failure.pending.then((failure) => ({ failure })),
    page.pending.then((page) => ({ page })),
    ...(work ? [work.then((value) => ({ value }))] : []),
  ])
  if ("failure" in selected) {
    return selected.failure
  }
  if ("value" in selected || selected.page.done) {
    return "value" in selected ? selected : undefined
  }
  page.pending = page.changes.next()
  return selected.page.value
}

/** @param {AbortSignal} signal @param {MediaSource} source @param {SourceBuffer} buffer @returns {Mse} */
const mse = (signal, source, buffer) => {
  /** @param {() => void} mutate */
  const update = async (mutate) => {
    const operation = event_latch(
      buffer,
      undefined,
      ["updateend", "error"],
      (event) => event,
    )
    try {
      mutate()
      const event = await operation.pending
      if (event?.type === "error") {
        throw event
      }
    } finally {
      operation.close()
    }
  }

  return (async function* () {
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
    const loaded = first_event(subtitle, signal, "load", "error")
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

/** @param {AbortSignal} signal @param {Mse} buffer @param {number} time @param {FailureStorm} failures @param {Acquisition} [acquisition] @returns {AsyncGenerator<SessionStep, SessionFailure | void, void>} */
const session = async function* (
  signal,
  buffer,
  time,
  failures,
  acquisition = {
    checkpoint: false,
    frontier: stream_position(time),
    mutating: false,
  },
) {
  let start = stream_position(time)
  /** @param {MseOperation} operation */
  const mutate = async (operation) => {
    acquisition.mutating = true
    try {
      return await buffer.next(operation)
    } finally {
      acquisition.mutating = false
    }
  }

  streaming: for (;;) {
    while (!signal.aborted && play_ahead(start) >= BUFFER.LO) {
      yield undefined
    }
    if (signal.aborted) {
      return
    }
    if ((await mutate(start)).done || signal.aborted) {
      return
    }
    if (acquisition.checkpoint) {
      acquisition.checkpoint = false
      yield "checkpoint"
    }
    const stream = source_stream(signal, start)
    try {
      for (;;) {
        const next = await stream.next()
        if (signal.aborted) {
          return
        }
        if (next.done) {
          if (next.value) {
            return {
              error: next.value.error,
              start: stream_position(buffered_end(start) ?? start),
            }
          }
          break streaming
        }
        if ((await mutate(next.value)).done || signal.aborted) {
          return
        }
        const next_start = stream_position(buffered_end(start) ?? start)
        if (next_start > start) {
          failures.recover()
        }
        start = next_start
        acquisition.frontier = start
        if (acquisition.checkpoint) {
          acquisition.checkpoint = false
          yield "checkpoint"
        }
        if (play_ahead(start) >= BUFFER.HI) {
          continue streaming
        }
      }
    } finally {
      await stream.return()
    }
  }
  if (!signal.aborted && !(await buffer.next("end")).done) {
    await first_event(signal, signal, "abort")
  }
}

/** @param {AbortSignal} signal @param {PageReader} page @param {MediaFailure} media_failure @param {number} start @param {number} revision @returns {Promise<number | SourceFailure | undefined>} */
const wait_to_retry = async (signal, page, media_failure, start, revision) => {
  if (media_failure.current !== undefined) {
    return media_failure.current
  }
  const timer = new AbortController()
  const delay = retry_delay(AbortSignal.any([signal, timer.signal]))
  try {
    for (;;) {
      const change = await source_change(page, media_failure, delay)
      if (change === undefined || "error" in change) {
        return change
      }
      if ("value" in change) {
        return change.value ? start : undefined
      }
      if (change.restart && change.revision > revision) {
        return page.position
      }
    }
  } finally {
    timer.abort()
  }
}

/** @param {AbortSignal} signal @param {Mse} buffer @param {FailureStorm} failures @param {PageReader} page @param {MediaFailure} media_failure @returns {Promise<SourceFailure | undefined>} */
const play_source = async (signal, buffer, failures, page, media_failure) => {
  let start = page.position
  let revision = page.revision
  for (;;) {
    if (media_failure.current !== undefined) {
      return media_failure.current
    }
    if (page.revision > revision) {
      start = page.position
      revision = page.revision
    }
    const attempt = new AbortController()
    const attempt_signal = AbortSignal.any([signal, attempt.signal])
    const acquisition = {
      checkpoint: false,
      frontier: stream_position(start),
      mutating: false,
    }
    const current = session(
      attempt_signal,
      buffer,
      start,
      failures,
      acquisition,
    )
    /** @type {Promise<IteratorResult<SessionStep, SessionFailure | void>> | undefined} */
    let progress = current.next()
    /** @type {SessionFailure | undefined} */
    let failure = undefined

    try {
      for (;;) {
        const change = await source_change(page, media_failure, progress)
        if (change === undefined || "error" in change) {
          return change
        }
        if ("value" in change) {
          const result = change.value
          progress = undefined
          if (result.done) {
            if (!result.value) {
              return undefined
            }
            failure = result.value
            break
          }
          if (result.value === "checkpoint") {
            revision = page.revision
            const target = page.position
            if (
              buffered_position(target) === undefined &&
              !aligned(target, acquisition.frontier)
            ) {
              start = target
              break
            }
            progress = current.next()
          }
          continue
        }
        if (change.revision > revision) {
          if (change.restart && acquisition.mutating) {
            acquisition.checkpoint = true
          } else {
            revision = change.revision
            if (
              change.restart &&
              !aligned(page.position, acquisition.frontier)
            ) {
              start = page.position
              break
            }
          }
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
    const waiting = await wait_to_retry(
      signal,
      page,
      media_failure,
      failure.start,
      revision,
    )
    if (waiting === undefined) {
      return undefined
    }
    if (typeof waiting !== "number") {
      return waiting
    }
    start = waiting
  }
}

/** @param {AbortSignal} signal */
const play_media = async (signal) => {
  const observation = new AbortController()
  const page = page_reader(
    AbortSignal.any([signal, observation.signal]),
    playable_position(Number(time_input.value)),
  )
  const failures = failure_storm()
  /** @type {string | undefined} */
  let attached_url = undefined
  let failed = media_failure(signal)
  try {
    for (;;) {
      const revision = page.revision
      const lifetime = new AbortController()
      const lifetime_signal = AbortSignal.any([signal, lifetime.signal])
      /** @type {Mse | undefined} */
      let buffer = undefined
      /** @type {SourceFailure | {setup: unknown} | undefined} */
      let failure = undefined
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
        failure = await play_source(
          lifetime_signal,
          buffer,
          failures,
          page,
          failed,
        )
      } catch (error) {
        if (lifetime_signal.aborted) {
          return
        }
        failure = buffer === undefined ? { setup: error } : { error }
      } finally {
        lifetime.abort()
        await buffer?.return()
        revoke_url(loose_url)
      }
      if (!failure) {
        return
      }
      failures.fail("setup" in failure ? failure.setup : failure.error)
      if (
        "setup" in failure &&
        (await wait_to_retry(signal, page, failed, page.position, revision)) ===
          undefined
      ) {
        return
      }
      if (signal.aborted) {
        return
      }
      failed.close()
      failed = media_failure(signal)
    }
  } finally {
    failed.close()
    media.removeAttribute("src")
    media.load()
    revoke_url(attached_url)
    observation.abort()
    await page.changes.return()
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
void main().catch(report)

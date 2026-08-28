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
/** @typedef {{state: IteratorResult<PageChange, void>} | {attempt: IteratorResult<void, void>} | {error: unknown}} PlaybackSelection */

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

  for (const type of [
    "canplay",
    "error",
    "loadedmetadata",
    "pause",
    "play",
    "playing",
    "seeked",
    "seeking",
    "timeupdate",
    "waiting",
  ]) {
    media.addEventListener(type, wake, { signal })
  }
  for (const type of ["error", "load"]) {
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
    const create_buffer = (buffer_signal) => {
      const buffer = source.addSourceBuffer(type)

      const abort_update = async () => {
        if (source.readyState !== "open" || !buffer.updating) {
          return
        }
        const aborted = once(buffer, undefined, "updateend")
        buffer.abort()
        await aborted
      }

      /** @param {() => void} mutate */
      const update = async (mutate) => {
        if (buffer_signal.aborted) {
          return false
        }
        const settled = select(
          buffer_signal,
          (s) => once(buffer, s, "updateend"),
          (s) => once(buffer, s, "error"),
        )
        mutate()
        if (await settled) {
          return true
        }
        await abort_update()
        return false
      }

      const frontier = () => {
        const ranges = buffer.buffered
        const last = ranges.length - 1
        return last < 0 ? undefined : ranges.end(last)
      }

      /** @returns {AsyncGenerator<void, void, MseOperation | undefined>} */
      const operations = async function* () {
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
                end > 0 &&
                buffer.buffered.length &&
                buffer.buffered.start(0) < end
              if (expired && !(await update(() => buffer.remove(0, end)))) {
                return
              }
              if (!(await update(() => buffer.appendBuffer(bytes)))) {
                return
              }
            }
          }
          if (source.readyState === "open") {
            source.endOfStream()
          }
        } finally {
          await abort_update()
          if (source.readyState !== "closed") {
            source.removeSourceBuffer(buffer)
          }
        }
        return
      }

      return Object.assign(operations(), {
        /** @param {number} position */
        contains: (position) => {
          const ranges = buffer.buffered
          for (let index = 0; index < ranges.length; index += 1) {
            if (
              ranges.start(index) <= position &&
              position < ranges.end(index)
            ) {
              return true
            }
          }
          return false
        },
        frontier,
        /** @param {number} position */
        play_ahead: (position) => (frontier() ?? position) - position,
      })
    }

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
        if (!signal.aborted) {
          await buffer.next()
        }
        await select(signal)
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
  const scope = new AbortController()
  const page_signal = AbortSignal.any([signal, scope.signal])
  const resume = Symbol("resume")
  const restart = Symbol("restart")
  const retry = Symbol("retry")
  const states = changes(page_signal)
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
    try {
      for await (const change of states) {
        await update(change, undefined)
      }
    } finally {
      scope.abort()
    }
    return
  }

  try {
    for (;;) {
      try {
        for await (const create_buffer of mse(page_signal)) {
          const current = new AbortController()
          const attempt_signal = AbortSignal.any([page_signal, current.signal])
          const session = attempt(attempt_signal, create_buffer)
          /** @type {Promise<IteratorResult<void, void>> | undefined} */
          let progress = session.next()

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
                          (attempt) =>
                            /** @type {PlaybackSelection} */ ({ attempt }),
                          (error) =>
                            /** @type {PlaybackSelection} */ ({ error }),
                        ),
                    ]
                  : []),
              )

              if (!selected) {
                break
              } else if ("state" in selected) {
                const { state } = selected
                if (state.done) {
                  return
                }
                changed = states.next()
                const action = await update(state.value, session.buffer)
                if (action === restart || action === retry) {
                  current.abort(action)
                  break
                }
                if (action === resume && progress === undefined) {
                  progress = session.next()
                }
              } else if ("error" in selected) {
                throw selected.error
              } else {
                progress = undefined
                if (selected.attempt.done) {
                  break
                }
              }
            }
          } catch (error) {
            if (!attempt_signal.aborted) {
              console.error(error)
            }
          } finally {
            current.abort()
            await session.return()
          }

          if (
            current.signal.reason !== restart &&
            !(await retry_delay(page_signal))
          ) {
            return
          }
        }
      } catch (error) {
        console.error(error)
      }
      if (!(await retry_delay(page_signal))) {
        return
      }
    }
  } finally {
    scope.abort()
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

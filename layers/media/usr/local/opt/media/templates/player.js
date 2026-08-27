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
const MSE_BUFFER_OPERATION = /** @type {const} */ ({
  APPEND: "append",
  SEEK: "seek",
})
/** @typedef {{type: typeof MSE_BUFFER_OPERATION.APPEND, position: number, bytes: Uint8Array} | {type: typeof MSE_BUFFER_OPERATION.SEEK, position: number}} MseBufferOperation */
const MSE_OPERATION = /** @type {const} */ ({ END: "end" })
/** @typedef {{type: typeof MSE_OPERATION.END}} MseOperation */
/** @typedef {{contains: (position: number) => boolean, frontier: () => number | undefined, play_ahead: (position: number) => number, operations: AsyncGenerator<void, void, MseBufferOperation>}} MseBuffer */

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

/** @param {unknown} selected @param {AbortSignal} signal @returns {selected is AbortSignal} */
const cancelled = (selected, signal) => selected === signal

/**
 * @template T
 * @param {AbortSignal} signal
 * @param {...((signal: AbortSignal) => Promise<T>)} cases
 * @returns {Promise<T | AbortSignal>}
 */
const select = async (signal, ...cases) => {
  if (signal.aborted) {
    return signal
  }

  const selection = new AbortController()
  try {
    return await Promise.race([
      once(signal, selection.signal, "abort").then(() => signal),
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

/** @param {AbortSignal} signal @param {SourceBuffer} buffer @param {() => boolean} open @returns {MseBuffer} */
const mse_buffer = (signal, buffer, open) => {
  /** @param {() => void} mutate */
  const update = async (mutate) => {
    if (signal.aborted) {
      return false
    }
    const operation = new AbortController()
    const sig = AbortSignal.any([signal, operation.signal])
    const settled = select(
      sig,
      (s) => once(buffer, s, "updateend"),
      (s) => once(buffer, s, "error"),
    )

    try {
      mutate()
      const selected = await settled
      if (selected instanceof Event) {
        return true
      }
      if (open() && buffer.updating) {
        const aborted = once(buffer, undefined, "updateend")
        buffer.abort()
        await aborted
      }
      return false
    } finally {
      operation.abort()
    }
  }

  /** @returns {AsyncGenerator<void, void, MseBufferOperation>} */
  const operations = async function* () {
    let operation = yield undefined
    try {
      for (;;) {
        switch (operation.type) {
          case MSE_BUFFER_OPERATION.APPEND: {
            const { bytes } = operation
            const end = operation.position - BUFFER.BEHIND
            if (
              end > 0 &&
              buffer.buffered.length &&
              buffer.buffered.start(0) < end
            ) {
              if (!(await update(() => buffer.remove(0, end)))) {
                return
              }
            }
            if (!(await update(() => buffer.appendBuffer(bytes)))) {
              return
            }
            break
          }
          case MSE_BUFFER_OPERATION.SEEK:
            if (
              !(await update(() => {
                buffer.timestampOffset = operation.position
              }))
            ) {
              return
            }
            break
          default:
            throw new Error("unknown MSE buffer operation")
        }

        operation = yield undefined
      }
    } finally {
      if (open() && buffer.updating) {
        const aborted = once(buffer, undefined, "updateend")
        buffer.abort()
        await aborted
      }
    }
  }

  const frontier = () => {
    const ranges = buffer.buffered
    const last = ranges.length - 1
    return last < 0 ? undefined : ranges.end(last)
  }

  return {
    /** @param {number} position */
    contains: (position) => {
      const ranges = buffer.buffered
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= position && position < ranges.end(index)) {
          return true
        }
      }
      return false
    },
    frontier,
    /** @param {number} position */
    play_ahead: (position) => (frontier() ?? position) - position,
    operations: operations(),
  }
}

/** @param {AbortSignal} signal @returns {AsyncGenerator<MseBuffer, void, MseOperation | undefined>} */
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
    if (cancelled(selected, signal)) {
      return
    }
    switch (selected.type) {
      case "sourceopen":
        if (Number.isFinite(duration) && duration > 0) {
          source.duration = duration
        }
        break
      case "sourceclose":
        throw selected
      default:
        throw new Error(selected.type)
    }

    for (;;) {
      const scope = new AbortController()
      const native = source.addSourceBuffer(type)
      const buffer = mse_buffer(
        AbortSignal.any([signal, scope.signal]),
        native,
        () => source.readyState === "open",
      )
      await buffer.operations.next()
      try {
        for (
          let operation = yield buffer;
          operation !== undefined;
          operation = yield buffer
        ) {
          switch (operation.type) {
            case MSE_OPERATION.END:
              if (source.readyState === "open") {
                source.endOfStream()
              }
              break
            default:
              throw new Error("unknown MSE operation")
          }
        }
      } finally {
        scope.abort()
        await buffer.operations.return()
        switch (source.readyState) {
          case "ended":
          case "open":
            source.removeSourceBuffer(native)
            break
          case "closed":
            break
          default:
            throw new Error(source.readyState)
        }
      }
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  const source = source_url(media, time)
  const request = new AbortController()
  const request_signal = AbortSignal.any([signal, request.signal])
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader = undefined

  try {
    const selected = await select(signal, () =>
      fetch(source, { signal: request_signal }),
    )
    if (cancelled(selected, signal)) {
      return
    }
    const response = selected
    const current = (reader = response.body?.getReader())
    if (!response.ok || !current) {
      throw new Error(`${response.statusText} - ${response.status}`)
    }
    for (;;) {
      const selected = await select(signal, () => current.read())
      if (cancelled(selected, signal)) {
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

/** @param {AbortSignal} signal @param {MseBuffer} buffer @param {number} time @param {() => Promise<boolean>} wait */
const resumable_stream = async function* (signal, buffer, time, wait) {
  l1: for (;;) {
    while (buffer.play_ahead(media.currentTime) >= BUFFER.LO) {
      if (!(await wait())) {
        return
      }
    }

    const start = buffer.frontier() ?? time
    if (
      (
        await buffer.operations.next({
          type: MSE_BUFFER_OPERATION.SEEK,
          position: start,
        })
      ).done
    ) {
      return
    }
    for await (const bytes of source_stream(signal, start)) {
      yield bytes
      if (buffer.play_ahead(media.currentTime) >= BUFFER.HI) {
        continue l1
      }
    }
    return
  }
}

/** @param {AbortSignal} root */
const stream = (root) => {
  const restart = Symbol("restart")
  let controller = new AbortController()
  /** @type {MseBuffer | undefined} */
  let active = undefined
  let ready = false
  let wake = Promise.withResolvers()

  const resume = () => wake.resolve(undefined)

  /** @param {AbortSignal} signal */
  const wait = async (signal) => {
    if ((await select(signal, () => wake.promise)) === signal) {
      return false
    }
    wake = Promise.withResolvers()
    return true
  }

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  /** @param {AsyncGenerator<MseBuffer, void, MseOperation | undefined>} source @param {MseBuffer} buffer */
  const attempt = async (source, buffer) => {
    ready = false
    const current = (controller = new AbortController())
    const signal = AbortSignal.any([root, current.signal])
    const time = Number(time_input.value)

    try {
      if (Math.abs(media.currentTime - time) > POSITION_TOLERANCE) {
        media.currentTime = time
      }
      for await (const bytes of resumable_stream(signal, buffer, time, () =>
        wait(signal),
      )) {
        if (
          (
            await buffer.operations.next({
              type: MSE_BUFFER_OPERATION.APPEND,
              position: media.currentTime,
              bytes,
            })
          ).done
        ) {
          break
        }
        if (!ready) {
          ready = true
          if (subtitle) {
            subtitle.src = source_url(subtitle, time)
          }
        }
      }
      if (!signal.aborted) {
        await source.next({ type: MSE_OPERATION.END })
        await select(signal)
      }
    } catch (error) {
      if (!signal.aborted) {
        console.error(error)
      }
    } finally {
      current.abort()
    }

    return current.signal.reason
  }

  const run = async () => {
    for (;;) {
      const source = mse(root)
      try {
        for (;;) {
          const selected = await source.next()
          if (selected.done) {
            break
          }
          const buffer = (active = selected.value)
          if (
            (await attempt(source, buffer)) !== restart &&
            (await retry_delay(root)) === root
          ) {
            return
          }
        }
      } catch (error) {
        console.error(error)
      } finally {
        await source.return()
      }
      if ((await retry_delay(root)) === root) {
        return
      }
    }
  }

  return {
    run,
    resume,
    retry: () => {
      if (ready) {
        stop(undefined)
      }
    },
    /** @param {boolean} seeking @param {number} time */
    position: (seeking, time) => {
      if (!ready) {
        return
      }
      if (seeking && !active?.contains(time)) {
        stop(restart)
      } else {
        resume()
      }
      set_position(time)
    },
  }
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

/** @param {AbortSignal} signal */
const load_direct = async (signal) => {
  const loaded = select(signal, (s) => once(media, s, "loadedmetadata"))
  media.src = source_url(media, media.currentTime)
  media.load()
  if (cancelled(await loaded, signal)) {
    return
  }
  if (initial_position > 0) {
    media.currentTime = initial_position
  }
}

/** @param {AbortSignal} signal */
const playback_page = async (signal) => {
  const scope = new AbortController()
  const child_signal = AbortSignal.any([signal, scope.signal])
  const streaming = transformed ? stream(child_signal) : undefined
  const child = (streaming ? streaming.run() : load_direct(child_signal)).catch(
    console.error,
  )
  let playback = Promise.resolve()
  let waiting = false

  /** @param {boolean} seeking */
  const update_position = (seeking) => {
    const time = media.currentTime
    if (!Number.isFinite(time)) {
      return
    }
    if (streaming) {
      streaming.position(seeking, time)
    } else {
      set_position(time)
    }
  }

  const continue_playback = async () => {
    if (
      cancelled(
        await select(child_signal, (s) => once(media, s, "canplay")),
        child_signal,
      )
    ) {
      return
    }
    waiting = false
    try {
      await media.play()
    } catch (error) {
      console.error(error)
    }
  }

  media.addEventListener(
    "play",
    () => {
      streaming?.resume()
      if (media.readyState >= media.HAVE_FUTURE_DATA) {
        waiting = false
        return
      }
      media.pause()
      if (!waiting) {
        waiting = true
        playback = continue_playback()
      }
    },
    { signal: child_signal },
  )
  media.addEventListener("seeking", () => update_position(true), {
    signal: child_signal,
  })
  media.addEventListener("timeupdate", () => update_position(false), {
    signal: child_signal,
  })
  media.addEventListener(
    "error",
    () => {
      if (media.error?.code !== MediaError.MEDIA_ERR_ABORTED) {
        streaming?.retry()
      }
    },
    { signal: child_signal },
  )
  subtitle?.addEventListener("error", () => streaming?.retry(), {
    signal: child_signal,
  })

  try {
    await select(child_signal)
  } finally {
    scope.abort()
    await Promise.all([child, playback])
  }
}

/** @param {AbortSignal} signal */
const pages = async function* (signal) {
  for (;;) {
    if (
      cancelled(
        await select(signal, (s) => once(window, s, "pageshow")),
        signal,
      )
    ) {
      return
    }
    const page = new AbortController()
    const page_signal = AbortSignal.any([signal, page.signal])
    window.addEventListener("pagehide", (event) => page.abort(event), {
      once: true,
      signal: page_signal,
    })

    try {
      yield page_signal
    } finally {
      page.abort()
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
  const root = new AbortController()
  try {
    for await (const page of pages(root.signal)) {
      await playback_page(page)
    }
  } catch (error) {
    console.error(error)
  } finally {
    root.abort()
  }
})()

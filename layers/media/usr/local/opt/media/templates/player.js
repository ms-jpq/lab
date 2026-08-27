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
const POSITION = `media:position:${location.pathname}`
const PAGE = crypto.randomUUID()

const media_source = () => {
  const { ManagedMediaSource } =
    /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
      globalThis
    )
  return new (ManagedMediaSource ?? MediaSource)()
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

/**
 * @param {AbortSignal} signal
 * @param {MediaSource} mse
 * @param {SourceBuffer} buffer
 */
const mse_buffer_update = async function* (signal, mse, buffer) {
  signal.throwIfAborted()
  const future = Promise.withResolvers()
  buffer.onupdateend = () => future.resolve(undefined)
  buffer.onerror = (event) => future.reject(event)

  const abort = () => {
    if (mse.readyState === "open" && buffer.updating) {
      buffer.abort()
    }
  }
  signal.addEventListener("abort", abort, { once: true })

  try {
    yield
    await future.promise
    signal.throwIfAborted()
  } finally {
    buffer.onupdateend = null
    buffer.onerror = null
    signal.removeEventListener("abort", abort)
  }
}

/** @param {MediaSource} mse @param {string} type */
const mse_buffer = (mse, type) => {
  const buffer = mse.addSourceBuffer(type)

  const frontier = () => {
    const ranges = buffer.buffered
    const last = ranges.length - 1
    return last < 0 ? undefined : ranges.end(last)
  }

  /** @param {number} position */
  const contains = (position) => {
    const ranges = buffer.buffered
    for (let index = 0; index < ranges.length; index += 1) {
      if (ranges.start(index) <= position && position <= ranges.end(index)) {
        return true
      }
    }
    return false
  }

  /** @param {number} position */
  const play_ahead = (position) => (frontier() ?? position) - position

  /** @param {AbortSignal} signal @param {number} position @param {Uint8Array} bytes */
  const append = async (signal, position, bytes) => {
    const end = position - BUFFER.BEHIND
    if (end > 0 && buffer.buffered.length && buffer.buffered.start(0) < end) {
      for await (const _ of mse_buffer_update(signal, mse, buffer)) {
        buffer.remove(0, end)
      }
    }
    for await (const _ of mse_buffer_update(signal, mse, buffer)) {
      buffer.appendBuffer(new Uint8Array(bytes))
    }
  }

  /** @param {number} position */
  const seek = (position) => {
    buffer.abort()
    buffer.timestampOffset = position
  }

  /** @param {AbortSignal} signal @param {number} position */
  const prepare = async (signal, position) => {
    signal.throwIfAborted()
    const duration = mse.duration
    if (buffer.buffered.length && Number.isFinite(duration)) {
      for await (const _ of mse_buffer_update(signal, mse, buffer)) {
        buffer.remove(0, duration)
      }
    }
    seek(position)
  }

  const end = () => {
    if (mse.readyState === "open") {
      mse.endOfStream()
    }
  }

  return { frontier, contains, play_ahead, append, seek, prepare, end }
}

/** @param {AbortSignal} signal */
const open_mse = async (signal) => {
  signal.throwIfAborted()
  const mse = media_source()
  const future = Promise.withResolvers()
  const type = /** @type {string} */ (media.dataset.mseType)
  const duration = Number(media.dataset.duration)

  mse.addEventListener(
    "sourceopen",
    () => {
      if (Number.isFinite(duration) && duration > 0) {
        mse.duration = duration
      }
      future.resolve(undefined)
    },
    { once: true },
  )
  const abort = () => future.resolve(undefined)
  signal.addEventListener("abort", abort, { once: true })

  try {
    media.src = URL.createObjectURL(mse)
    await future.promise
    signal.throwIfAborted()
    return mse_buffer(mse, type)
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

/** @param {number} time */
const reload_subtitle = (time) => {
  if (!subtitle) {
    return
  }
  subtitle.src = source_url(subtitle, time)
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  signal.throwIfAborted()
  const source = source_url(media, time)
  const response = await fetch(source, { signal })
  const reader = response.body?.getReader()

  try {
    if (!response.ok || !reader) {
      throw new Error(`${response.statusText} ${response.status}`)
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        return
      }
      yield value
    }
  } finally {
    await reader?.cancel()
  }
}

/** @param {AbortSignal} signal @param {ReturnType<typeof mse_buffer>} buffer @param {number} time @param {() => Promise<void>} wait */
const resumable_stream = async function* (signal, buffer, time, wait) {
  l1: for (;;) {
    while (buffer.play_ahead(media.currentTime) >= BUFFER.LO) {
      await wait()
      signal.throwIfAborted()
    }

    const start = buffer.frontier() ?? time
    buffer.seek(start)
    for await (const bytes of source_stream(signal, start)) {
      yield bytes
      if (buffer.play_ahead(media.currentTime) >= BUFFER.HI) {
        continue l1
      }
    }
    return
  }
}

const stream = () => {
  const restart = Symbol("restart")
  const retrying = Symbol("retrying")

  let controller = new AbortController()
  /** @type {ReturnType<typeof mse_buffer> | undefined} */
  let buffer = undefined
  let can_seek = false
  /** @type {number | undefined} */
  let restored_position = undefined
  let wake = Promise.withResolvers()

  const resume = () => wake.resolve(undefined)

  const wait = async () => {
    await wake.promise
    wake = Promise.withResolvers()
  }

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  const retry = () => {
    if (can_seek) {
      stop(retrying)
    }
  }

  const run = async () => {
    for (;;) {
      can_seek = false
      const { signal } = controller
      const time = Number(time_input.value)

      try {
        if (buffer === undefined) {
          buffer = await open_mse(signal)
          if (media.currentTime !== time) {
            media.currentTime = time
            restored_position = media.currentTime
          }
        }

        await buffer.prepare(signal, time)
        for await (const bytes of resumable_stream(
          signal,
          buffer,
          time,
          wait,
        )) {
          await buffer.append(signal, media.currentTime, bytes)
          if (!can_seek) {
            can_seek = true
            reload_subtitle(time)
          }
        }
        buffer.end()
        return
      } catch (error) {
        if (signal.reason === restart) {
          continue
        }
        if (signal.aborted && signal.reason !== retrying) {
          return
        }
        if (!signal.aborted) {
          console.error(error)
        }
        buffer = undefined
      } finally {
        controller.abort()
        controller = new AbortController()
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    }
  }

  /** @param {boolean} seeking @param {number} time */
  const accept_position = (seeking, time) => {
    if (seeking && restored_position !== undefined) {
      const restored = time === restored_position
      restored_position = undefined
      if (restored) {
        return false
      }
    }
    if (!can_seek) {
      return false
    }
    if (!seeking || buffer?.contains(time)) {
      resume()
      return true
    }
    can_seek = false
    stop(restart)
    return true
  }

  return { accept_position, retry, stop, resume, run }
}

const streaming = media.dataset.transformed === "true" ? stream() : undefined

if (subtitle) {
  subtitle.onerror = () => streaming?.retry()
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
  const rounded = Math.round(value * 1_000) / 1_000
  time_input.value = String(rounded)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
  try {
    localStorage.setItem(POSITION, time_input.value)
  } catch {}
}

if (!streaming) {
  media.addEventListener(
    "loadedmetadata",
    () => {
      if (initial_position > 0) {
        media.currentTime = initial_position
      }
    },
    { once: true },
  )
  media.src = source_url(media, media.currentTime)
  media.load()
}

media.onerror = () => {
  if (media.error?.code !== MediaError.MEDIA_ERR_ABORTED) {
    streaming?.retry()
  }
}

media.onplay = () => streaming?.resume()

/** @param {boolean} seeking */
const update_position = (seeking) => {
  const time = media.currentTime
  if (!Number.isFinite(time)) {
    return
  }
  if (streaming && !streaming.accept_position(seeking, time)) {
    return
  }
  set_position(time)
}

media.onseeking = () => update_position(true)
media.ontimeupdate = () => update_position(false)

set_position(initial_position)
onpagehide = () => streaming?.stop(undefined)
onpageshow = () => streaming?.run()

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

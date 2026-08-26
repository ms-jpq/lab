const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)
const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)
const time_input = /** @type {HTMLInputElement} */ (
  document.querySelector("form")?.elements.namedItem("t")
)

const MAX_PLAY_AHEAD = 30
const RETRY_DELAY = 1_000

/** @param {HTMLMediaElement | HTMLTrackElement} resource @param {number | string} time */
const source_url = (resource, time) => {
  const source = new URL(
    /** @type {string} */ (resource.dataset.src),
    location.href,
  )
  source.searchParams.set("t", String(time))
  return source.toString()
}

/** @param {number} value */
const set_position = (value) => {
  const page_url = new URL(location.href)
  const rounded = Math.round(value * 1_000) / 1_000
  time_input.value = String(rounded)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
}

/**
 * @param {MediaSource} mse
 * @param {SourceBuffer} buffer
 * @param {AbortSignal} signal
 * @param {() => void} operation
 */
const mse_buffer_update = async (mse, buffer, signal, operation) => {
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
    operation()
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
    const ranges = media.buffered
    const last = ranges.length - 1
    return last < 0 ? undefined : ranges.end(last)
  }

  /** @param {number} position @param {number} [fallback] */
  const play_ahead = (position, fallback = position) =>
    (frontier() ?? fallback) - position

  /** @param {AbortSignal} signal @param {Uint8Array} bytes */
  const append = (signal, bytes) =>
    mse_buffer_update(mse, buffer, signal, () =>
      buffer.appendBuffer(new Uint8Array(bytes)),
    )

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
      await mse_buffer_update(mse, buffer, signal, () =>
        buffer.remove(0, duration),
      )
    }
    seek(position)
  }

  const end = () => {
    if (mse.readyState === "open") {
      mse.endOfStream()
    }
  }

  return { frontier, play_ahead, append, seek, prepare, end }
}

/** @param {HTMLMediaElement} media @param {string} source */
const load_media = (media, source) => {
  media.src = source
  media.load()
}

/** @param {number | string} time */
const reload_subtitle = (time) => {
  if (!subtitle) {
    return
  }
  const source = new URL(source_url(subtitle, time))
  source.searchParams.set("retry", crypto.randomUUID())
  subtitle.src = source.toString()
}

/** @param {AbortSignal} signal */
const open_mse = async (signal) => {
  signal.throwIfAborted()
  const mse = new MediaSource()
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
  const abort = () => future.reject(signal.reason)
  signal.addEventListener("abort", abort, { once: true })

  try {
    load_media(media, URL.createObjectURL(mse))
    await future.promise
    signal.throwIfAborted()
    return mse_buffer(mse, type)
  } finally {
    signal.removeEventListener("abort", abort)
  }
}

const stream = () => {
  const restart = Symbol("restart")
  const retrying = Symbol("retrying")

  let controller = new AbortController()
  let can_seek = false
  let wake = Promise.withResolvers()

  const resume = () => wake.resolve(undefined)

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  const retry = () => stop(retrying)

  /** @param {ReturnType<typeof mse_buffer>} buffer @param {AbortSignal} signal */
  const resumable_stream = async function* (buffer, signal) {
    const pausing = () =>
      media.paused && buffer.play_ahead(media.currentTime) >= MAX_PLAY_AHEAD

    resumable: for (;;) {
      while (pausing()) {
        await wake.promise
        signal.throwIfAborted()
        wake = Promise.withResolvers()
      }

      const start = buffer.frontier() ?? media.currentTime
      buffer.seek(start)
      const response = await fetch(source_url(media, start), { signal })

      if (!response.ok || !response.body) {
        throw new Error(`${response.statusText} ${response.status}`)
      }

      for await (const bytes of response.body) {
        yield bytes
        if (pausing()) {
          continue resumable
        }
      }
      return
    }
  }

  const run = async () => {
    /** @type {ReturnType<typeof mse_buffer> | undefined} */
    let buffer

    for (;;) {
      can_seek = false
      const { signal } = controller

      try {
        if (buffer === undefined) {
          buffer = await open_mse(signal)
        }
        signal.throwIfAborted()
        await buffer.prepare(signal, media.currentTime)
        for await (const bytes of resumable_stream(buffer, signal)) {
          await buffer.append(signal, bytes)
          can_seek = true
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
        reload_subtitle(media.currentTime)
      } finally {
        controller.abort()
        controller = new AbortController()
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    }
  }

  const start = () => void run()

  /** @param {number} time */
  const seek = (time) => {
    if (can_seek) {
      can_seek = false
      reload_subtitle(time)
      stop(restart)
    }
  }

  return { retry, stop, resume, seek, start }
}

const streaming = media.dataset.transformed === "true" ? stream() : undefined

addEventListener("pagehide", (event) => streaming?.stop(event), { once: true })

if (subtitle) {
  subtitle.onerror = () => streaming?.retry()
}

{
  const initial_position = Number(time_input.value)

  media.currentTime = initial_position

  if (!streaming) {
    load_media(media, source_url(media, media.currentTime))
  }

  media.onerror = () => streaming?.retry()

  media.addEventListener(
    "loadedmetadata",
    () => {
      if (!streaming && initial_position > 0) {
        media.currentTime = initial_position
      }
    },
    { once: true },
  )

  media.onplay = () => streaming?.resume()

  media.onseeking = () => {
    const target = media.currentTime
    if (!Number.isFinite(target)) {
      return
    }
    set_position(target)
    if (streaming) {
      streaming.seek(target)
    }
  }

  media.ontimeupdate = () => {
    const current = Math.round(media.currentTime * 1_000) / 1_000
    if (!Number.isFinite(current)) {
      return
    }
    set_position(current)
    streaming?.resume()
  }

  set_position(initial_position)
}

streaming?.start()

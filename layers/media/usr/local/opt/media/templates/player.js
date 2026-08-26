/** @param {string} selector */
const element = (selector) => document.querySelector(selector)
const media = /** @type {HTMLMediaElement} */ (element("video, audio"))
const form = /** @type {HTMLFormElement} */ (element("form"))
const time_input = /** @type {HTMLInputElement} */ (
  form.elements.namedItem("t")
)
const subtitle = /** @type {HTMLTrackElement | null} */ (element("#subtitle"))

const mse = media.dataset.transformed === "true" ? new MediaSource() : undefined
const MAX_PLAY_AHEAD = 30

/** @param {MediaSource} mse @param {string} type */
const mse_buffer = (mse, type) => {
  const buffer = mse.addSourceBuffer(type)

  const frontier = () => {
    const ranges = buffer.buffered
    const last = ranges.length - 1
    return last < 0 ? undefined : ranges.end(last)
  }

  /**
   * @param {() => void} operation
   * @param {AbortSignal} signal
   */
  const update = async (operation, signal) => {
    signal.throwIfAborted()
    const { promise, reject, resolve } =
      /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
    buffer.onupdateend = () => resolve(undefined)
    buffer.onerror = () => reject(new Error("MSE update failed"))
    signal.onabort = () => {
      if (mse.readyState === "open") {
        buffer.abort()
      }
    }

    try {
      operation()
      await promise
      signal.throwIfAborted()
    } finally {
      buffer.onupdateend = null
      buffer.onerror = null
      signal.onabort = null
    }
  }

  /** @param {Uint8Array} bytes @param {AbortSignal} signal */
  const append = (bytes, signal) =>
    update(() => buffer.appendBuffer(bytes), signal)

  /** @param {number} position */
  const seek = (position) => (buffer.timestampOffset = position)

  /** @param {number} position @param {AbortSignal} signal */
  const prepare = async (position, signal) => {
    signal.throwIfAborted()
    if (buffer.buffered.length) {
      const duration = mse.duration
      if (mse.readyState === "ended" && Number.isFinite(duration)) {
        mse.duration = duration
      }
      buffer.abort()
      if (Number.isFinite(duration)) {
        await update(() => buffer.remove(0, duration), signal)
      }
    }
    seek(position)
  }

  const end = () => {
    if (mse.readyState === "open") {
      mse.endOfStream()
    }
  }

  return { append, end, frontier, prepare, seek }
}

/** @param {HTMLMediaElement | HTMLTrackElement} resource @param {number | string} [time] */
const source_url = (resource, time = media.currentTime) => {
  const source = new URL(
    /** @type {string} */ (resource.dataset.src),
    location.href,
  )
  source.searchParams.set("t", String(time))
  return source.toString()
}

/** @param {boolean} retry */
const reload_subtitle = (retry) => {
  if (!subtitle) {
    return
  }
  const source = new URL(source_url(subtitle))
  if (retry) {
    source.searchParams.set("retry", crypto.randomUUID())
  }
  subtitle.src = source.toString()
}

/** @param {HTMLMediaElement} media @param {string} source */
const load_media = (media, source) => {
  media.src = source
  media.load()
}

/** @param {MediaSource} mse */
const open_mse = async (mse) => {
  const opened = Promise.withResolvers()
  const type = /** @type {string} */ (media.dataset.mseType)
  const duration = Number(media.dataset.duration)

  mse.onsourceopen = () => {
    mse.onsourceopen = null
    if (Number.isFinite(duration) && duration > 0) {
      mse.duration = duration
    }
    opened.resolve(undefined)
  }
  load_media(media, URL.createObjectURL(mse))

  await opened.promise
  return mse_buffer(mse, type)
}

/** @param {MediaSource} mse */
const stream = (mse) => {
  const restart = Symbol("restart")
  const opened = open_mse(mse)
  let delay = 1_000
  let controller = new AbortController()
  let wake = () => {}

  const resume = () => wake()
  const ready = () => {
    delay = 1_000
  }

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  const seek = () => stop(restart)

  /** @param {ReturnType<typeof mse_buffer>} buffer */
  const resumable_stream = async function* (buffer) {
    const play_ahead = (fallback = media.currentTime) =>
      (buffer.frontier() ?? fallback) - media.currentTime

    for (;;) {
      while (play_ahead() >= MAX_PLAY_AHEAD) {
        await new Promise((resolve) => (wake = () => resolve(undefined)))
        controller.signal.throwIfAborted()
      }

      const start = buffer.frontier() ?? media.currentTime
      let capped = false
      buffer.seek(start)
      const response = await fetch(source_url(media, start), {
        signal: controller.signal,
      })
      if (!response.ok || response.body === null) {
        throw new Error("stream request failed")
      }

      for await (const bytes of response.body) {
        yield bytes
        if (play_ahead(start) >= MAX_PLAY_AHEAD) {
          capped = true
          break
        }
      }

      if (!capped) {
        return
      }
    }
  }

  const run = async () => {
    const buffer = await opened

    for (;;) {
      controller = new AbortController()

      try {
        await buffer.prepare(media.currentTime, controller.signal)
        for await (const bytes of resumable_stream(buffer)) {
          await buffer.append(bytes, controller.signal)
        }
        buffer.end()
        return
      } catch (error) {
        controller.abort()
        if (controller.signal.reason === restart) {
          continue
        }
        console.error(error)
        await new Promise((resolve) => setTimeout(resolve, delay))
        delay = Math.min(delay * 2, 8_000)
        reload_subtitle(true)
      }
    }
  }

  return { stop, ready, resume, run, seek }
}

const streaming = mse === undefined ? undefined : stream(mse)

{
  const initial_position = Number(time_input.value)

  /** @param {number} value */
  const set_position = (value) => {
    const page_url = new URL(location.href)
    const rounded = Math.round(value * 1_000) / 1_000
    time_input.value = String(rounded)
    page_url.searchParams.set("t", time_input.value)
    history.replaceState(null, "", page_url)
  }

  media.currentTime = initial_position

  media.onerror = () => streaming?.stop(new Error("media error"))

  media.onloadedmetadata = () => {
    streaming?.ready()
    if (!streaming && initial_position > 0) {
      media.currentTime = initial_position
    }
  }

  media.onplay = () => {
    media.onplay = null
    reload_subtitle(false)
    streaming?.resume()
  }

  media.onseeking = () => {
    const target = media.currentTime
    if (!Number.isFinite(target)) {
      return
    }
    set_position(target)
    if (media.onplay === null) {
      reload_subtitle(false)
    }
    streaming?.seek()
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

if (subtitle) {
  subtitle.onerror = () => streaming?.stop(new Error("subtitle error"))
  subtitle.onload = () => streaming?.ready()
}

if (streaming) {
  void streaming.run()
} else {
  load_media(media, source_url(media))
}

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

/**
 * @param {MediaSource} mse
 * @param {SourceBuffer} buffer
 * @param {AbortSignal} signal
 * @param {() => void} operation
 */
const mse_buffer_update = async (mse, buffer, signal, operation) => {
  signal.throwIfAborted()
  const { promise, reject, resolve } =
    /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
  buffer.onupdateend = () => resolve(undefined)
  buffer.onerror = (event) => reject(event)

  signal.onabort = () => {
    if (mse.readyState === "open" && buffer.updating) {
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

/** @param {MediaSource} mse @param {string} type */
const mse_buffer = (mse, type) => {
  const buffer = mse.addSourceBuffer(type)

  const frontier = () => {
    const ranges = buffer.buffered
    const last = ranges.length - 1
    return last < 0 ? undefined : ranges.end(last)
  }

  /** @param {number} position @param {number} [fallback] */
  const play_ahead = (position, fallback = position) =>
    (frontier() ?? fallback) - position

  /** @param {Uint8Array} bytes @param {AbortSignal} signal */
  const append = (bytes, signal) =>
    mse_buffer_update(mse, buffer, signal, () => buffer.appendBuffer(bytes))

  /** @param {number} position */
  const seek = (position) => {
    buffer.abort()
    buffer.timestampOffset = position
  }

  /** @param {number} position @param {AbortSignal} signal */
  const prepare = async (position, signal) => {
    signal.throwIfAborted()
    if (buffer.buffered.length) {
      const duration = mse.duration
      if (mse.readyState === "ended" && Number.isFinite(duration)) {
        mse.duration = duration
      }
      if (Number.isFinite(duration)) {
        await mse_buffer_update(mse, buffer, signal, () =>
          buffer.remove(0, duration),
        )
      }
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

const open_mse = async () => {
  const mse = new MediaSource()
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

const stream = () => {
  const restart = Symbol("restart")
  let controller = new AbortController()
  let wake = () => {}

  const resume = () => wake()

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  const seek = () => stop(restart)

  /** @param {ReturnType<typeof mse_buffer>} buffer @param {AbortSignal} signal */
  const resumable_stream = async function* (buffer, signal) {
    for (;;) {
      while (buffer.play_ahead(media.currentTime) >= MAX_PLAY_AHEAD) {
        await new Promise((resolve) => (wake = () => resolve(undefined)))
        signal.throwIfAborted()
      }

      const start = buffer.frontier() ?? media.currentTime
      buffer.seek(start)
      const response = await fetch(source_url(media, start), {
        signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`${response.statusText} ${response.status}`)
      }

      let capped = false
      for await (const bytes of response.body) {
        yield bytes
        if (buffer.play_ahead(media.currentTime, start) >= MAX_PLAY_AHEAD) {
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
    for (;;) {
      controller = new AbortController()
      const { signal } = controller
      const buffer = await open_mse()

      for (;;) {
        try {
          signal.throwIfAborted()
          await buffer.prepare(media.currentTime, signal)
          for await (const bytes of resumable_stream(buffer, signal)) {
            await buffer.append(bytes, signal)
          }
          buffer.end()
          return
        } catch (error) {
          controller.abort()
          if (controller.signal.reason === restart) {
            controller = new AbortController()
            continue
          }
          console.error(error)
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
          reload_subtitle(true)
          break
        }
      }
    }
  }

  return { stop, resume, run, seek }
}

const streaming = media.dataset.transformed === "true" ? stream() : undefined

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

  media.onerror = (event) => streaming?.stop(event)

  media.onloadedmetadata = () => {
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
  subtitle.onerror = (event) => streaming?.stop(event)
}

if (streaming) {
  void streaming.run()
} else {
  load_media(media, source_url(media))
}

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
const STATE = Object.freeze({
  INITIAL: "initial",
  LOADING: "loading",
  READY: "ready",
})

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

const open_mse = async () => {
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
  load_media(media, URL.createObjectURL(mse))

  await future.promise
  return mse_buffer(mse, type)
}

const stream = () => {
  const restart = Symbol("restart")
  let controller = new AbortController()
  /** @type {(typeof STATE)[keyof typeof STATE]} */
  let state = STATE.INITIAL
  let wake = Promise.withResolvers()

  const resume = () => wake.resolve(undefined)

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

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
    for (;;) {
      state = STATE.LOADING
      const buffer = await open_mse()
      reload_subtitle(media.currentTime)

      for (;;) {
        const { signal } = controller

        try {
          signal.throwIfAborted()
          await buffer.prepare(signal, media.currentTime)
          for await (const bytes of resumable_stream(buffer, signal)) {
            await buffer.append(signal, bytes)
            state = STATE.READY
          }
          buffer.end()
          return
        } catch (error) {
          if (signal.reason === restart) {
            continue
          }
          if (signal.aborted) {
            return
          }
          console.error(error)
        } finally {
          controller.abort()
          controller = new AbortController()
        }
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
        break
      }
    }
  }

  const seek = () => {
    if (state === STATE.INITIAL) {
      state = STATE.LOADING
      void run()
      return
    }
    if (state === STATE.READY) {
      state = STATE.LOADING
      stop(restart)
    }
  }

  return { stop, resume, seek }
}

const streaming = media.dataset.transformed === "true" ? stream() : undefined

addEventListener("pagehide", (event) => streaming?.stop(event), { once: true })

{
  const initial_position = Number(time_input.value)

  media.currentTime = initial_position

  if (!streaming) {
    load_media(media, source_url(media, media.currentTime))
    reload_subtitle(initial_position)
  }

  media.onerror = (event) => streaming?.stop(event)

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
    reload_subtitle(target)
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

streaming?.seek()

const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)

const form = /** @type {HTMLFormElement} */ (document.querySelector("form"))

const time_input = /** @type {HTMLInputElement} */ (
  form.elements.namedItem("t")
)

const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)

const mse = media.dataset.transformed === "true" ? new MediaSource() : undefined

/** @param {AbortSignal} signal */
const aborted = async (signal) => {
  signal.throwIfAborted()
  const { promise, reject } = /** @type {PromiseWithResolvers<never>} */ (
    Promise.withResolvers()
  )
  signal.onabort = () => reject(signal.reason)

  try {
    await promise
  } finally {
    signal.onabort = null
  }
}

/** @param {string} url @param {AbortSignal} signal */
const fetch_stream = async function* (url, signal) {
  const response = await fetch(url, { signal })
  if (!response.ok || response.body === null) {
    throw new Error("stream request failed")
  }
  yield* response.body
}

/** @param {MediaSource} mse @param {string} type */
const mse_buffer = (mse, type) => {
  const buffer = mse.addSourceBuffer(type)
  let populated = false

  /**
   * @param {() => void} operation
   * @param {AbortSignal} signal
   * @param {(() => void) | undefined} cancel
   */
  const update = async (operation, signal, cancel) => {
    signal.throwIfAborted()
    const { promise, reject, resolve } =
      /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
    buffer.onupdateend = () => resolve(undefined)
    buffer.onerror = () => reject(new Error("MSE update failed"))
    signal.onabort = () => cancel?.()

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
  const append = (bytes, signal) => {
    populated = true
    return update(
      () => buffer.appendBuffer(bytes),
      signal,
      () => {
        if (mse.readyState === "open") {
          buffer.abort()
        }
      },
    )
  }

  /** @param {number} position */
  const seek = (position) => {
    buffer.timestampOffset = position
  }

  /** @param {number} position @param {AbortSignal} signal */
  const prepare = async (position, signal) => {
    signal.throwIfAborted()
    if (!populated) {
      seek(position)
      return
    }
    const duration = mse.duration
    if (mse.readyState === "ended" && Number.isFinite(duration)) {
      mse.duration = duration
    }
    buffer.abort()
    if (Number.isFinite(duration)) {
      await update(() => buffer.remove(0, duration), signal, undefined)
    }
    seek(position)
  }

  return { append, prepare, seek }
}

/** @param {HTMLMediaElement} media @param {string} source */
const load_media = (media, source) => {
  media.src = source
  media.load()
}

/**
 * @param {{ duration: number; media: HTMLMediaElement; mse: MediaSource; type: string }} options
 */
const open_mse = async ({ duration, media, mse, type }) => {
  const opened = Promise.withResolvers()
  mse.onsourceopen = () => {
    mse.onsourceopen = null
    if (Number.isFinite(duration) && duration > 0) {
      mse.duration = duration
    }
    opened.resolve(undefined)
  }
  load_media(media, URL.createObjectURL(mse))

  await opened.promise
  const buffer = mse_buffer(mse, type)

  /** @param {number} position */
  const seek = (position) => {
    buffer.seek(position)
    media.currentTime = position
  }

  const end = () => {
    if (mse.readyState === "open") {
      mse.endOfStream()
    }
  }

  return { append: buffer.append, end, prepare: buffer.prepare, seek }
}

const backoff = () => {
  let delay = 1_000

  const ready = () => {
    delay = 1_000
  }

  const wait = async () => {
    await new Promise((resolve) => setTimeout(resolve, delay))
    delay = Math.min(delay * 2, 8_000)
  }

  return { ready, wait }
}

/**
 * @param {{
 *   opened: ReturnType<typeof open_mse>
 *   position: () => number
 *   recover: () => void
 *   source: () => string
 * }} options
 */
const stream = ({ opened, position, recover, source }) => {
  const restart = Symbol("restart")
  const retry = backoff()

  let controller = new AbortController()

  /** @param {unknown} error */
  const fail = (error) => controller.abort(error)

  const seek = () => controller.abort(restart)

  const run = async () => {
    const buffer = await opened
    buffer.seek(position())

    for (;;) {
      controller = new AbortController()

      try {
        await buffer.prepare(position(), controller.signal)

        for await (const bytes of fetch_stream(source(), controller.signal)) {
          await buffer.append(bytes, controller.signal)
        }
        buffer.end()
        await aborted(controller.signal)
      } catch (error) {
        controller.abort()
        if (controller.signal.reason === restart) {
          continue
        }
        console.error(error)
        await retry.wait()
        recover()
      }
    }
  }

  return { fail, ready: retry.ready, run, seek }
}

void (() => {
  const page_url = new URL(location.href)

  const position = () => Number(time_input.value)

  /** @param {number} value */
  const set_position = (value) => {
    const rounded = Math.round(value * 1_000) / 1_000
    time_input.value = String(rounded)
    page_url.searchParams.set("t", time_input.value)
    history.replaceState(null, "", page_url)
  }

  /** @param {HTMLMediaElement | HTMLTrackElement} resource */
  const source_url = (resource) => {
    const source = new URL(
      /** @type {string} */ (resource.dataset.src),
      location.href,
    )
    source.searchParams.set("t", time_input.value)
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

  const streaming = (() => {
    if (mse === undefined) {
      return
    }
    const type = /** @type {string} */ (media.dataset.mseType)
    const opened = open_mse({
      duration: Number(media.dataset.duration),
      media,
      mse,
      type,
    })
    return stream({
      opened,
      position,
      recover: () => reload_subtitle(true),
      source: () => source_url(media),
    })
  })()

  const start = () => {
    media.onplay = null
    reload_subtitle(false)
    void streaming?.run()
  }

  /** @param {number} target */
  const restart_at = (target) => {
    if (!Number.isFinite(target)) {
      return
    }
    set_position(target)
    if (media.onplay === null) {
      reload_subtitle(false)
    }
    streaming?.seek()
  }

  {
    media.onloadedmetadata = () => {
      streaming?.ready()
      if (!streaming && position() > 0) {
        media.currentTime = position()
      }
    }
    media.onerror = () => streaming?.fail(new Error("media error"))
    media.onseeking = () => restart_at(media.currentTime)
    media.onplay = start

    media.ontimeupdate = () => {
      const current = Math.round(media.currentTime * 1_000) / 1_000
      if (!Number.isFinite(current) || current === position()) {
        return
      }
      set_position(current)
    }
    set_position(position())
  }

  if (subtitle) {
    subtitle.onerror = () => streaming?.fail(new Error("subtitle error"))
    subtitle.onload = () => streaming?.ready()
  }

  if (!streaming) {
    load_media(media, source_url(media))
  }
})()

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

/**
 * @param {{
 *   media: HTMLMediaElement
 *   mse: MediaSource
 *   opened: Promise<void>
 *   position: () => number
 *   source: () => string
 *   type: string
 * }} options
 */
const stream = ({ media, mse, opened, position, source, type }) => {
  const restart = Symbol("restart")

  /** @type {AbortController | undefined} */
  let controller
  let retry_delay = 1_000

  /** @param {SourceBuffer} buffer */
  const source_buffer = (buffer) => {
    /** @param {() => void} operation */
    const update = async (operation) => {
      const { promise, reject, resolve } =
        /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
      buffer.onupdateend = () => resolve(undefined)
      buffer.onerror = () => reject(new Error("MSE update failed"))

      try {
        operation()
        await promise
      } finally {
        buffer.onupdateend = null
        buffer.onerror = null
      }
    }

    /** @param {Uint8Array} bytes */
    const append = (bytes) => update(() => buffer.appendBuffer(bytes))

    /** @param {number} position */
    const seek = (position) => {
      buffer.timestampOffset = position
    }

    /** @param {number} duration */
    const reset = async (duration) => {
      buffer.abort()
      if (Number.isFinite(duration)) {
        await update(() => buffer.remove(0, duration))
      }
    }

    return { append, reset, seek }
  }

  /** @param {string} url @param {AbortController} controller */
  const fetch_stream = async function* (url, controller) {
    let complete = false

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok || response.body === null) {
        throw new Error("stream request failed")
      }
      yield* response.body
      complete = true
    } finally {
      if (!complete) {
        controller.abort()
      }
    }
  }

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

  /** @param {unknown} error */
  const fail = (error) => controller?.abort(error)

  const ready = () => {
    retry_delay = 1_000
  }

  const seek = () => controller?.abort(restart)

  const run = async () => {
    await opened
    const buffer = source_buffer(mse.addSourceBuffer(type))
    buffer.seek(position())
    media.currentTime = position()

    let replace = false
    for (;;) {
      const current = new AbortController()
      controller = current

      try {
        const source_duration = mse.duration
        if (mse.readyState === "ended" && Number.isFinite(source_duration)) {
          mse.duration = source_duration
        }
        if (replace) {
          await buffer.reset(source_duration)
        }
        replace = true
        buffer.seek(position())

        for await (const bytes of fetch_stream(source(), current)) {
          await buffer.append(bytes)
        }
        if (mse.readyState === "open") {
          mse.endOfStream()
        }
        await aborted(current.signal)
      } catch (error) {
        if (current.signal.reason === restart) {
          continue
        }
        console.error(error)
        await new Promise((resolve) => setTimeout(resolve, retry_delay))
        retry_delay = Math.min(retry_delay * 2, 8_000)
      } finally {
        controller = undefined
      }
    }
  }

  return { fail, ready, seek, start: () => void run() }
}

void (() => {
  const page_url = new URL(location.href)

  let position = Number(time_input.value)

  const sync_position = () => {
    position = Math.round(position * 1_000) / 1_000
    time_input.value = String(position)
    page_url.searchParams.set("t", time_input.value)
    history.replaceState(null, "", page_url)
  }

  /** @param {HTMLMediaElement | HTMLTrackElement} resource */
  const source_url = (resource) => {
    const source = new URL(resource.dataset.src ?? resource.src, location.href)
    source.searchParams.set("t", time_input.value)
    return source.toString()
  }

  const streaming = (() => {
    if (mse === undefined) {
      return
    }
    const type = media.dataset.mseType
    if (
      type === undefined ||
      !MediaSource.isTypeSupported(type) ||
      media.dataset.src === undefined
    ) {
      throw new Error("unsupported MSE source")
    }
    const opened = /** @type {PromiseWithResolvers<void>} */ (
      Promise.withResolvers()
    )
    mse.onsourceopen = () => {
      mse.onsourceopen = null
      const duration = Number(media.dataset.duration)
      if (Number.isFinite(duration) && duration > 0) {
        mse.duration = duration
      }
      opened.resolve(undefined)
    }
    media.src = URL.createObjectURL(mse)
    media.load()
    return stream({
      media,
      mse,
      opened: opened.promise,
      position: () => position,
      source: () => source_url(media),
      type,
    })
  })()

  let started = false

  const start = () => {
    if (started) {
      return
    }
    started = true
    if (subtitle) {
      subtitle.src = source_url(subtitle)
    }
    streaming?.start()
  }

  /** @param {number} target */
  const restart_at = (target) => {
    if (!Number.isFinite(target)) {
      return
    }
    position = target
    sync_position()
    if (started && subtitle) {
      subtitle.src = source_url(subtitle)
    }
    streaming?.seek()
  }

  media.onloadedmetadata = () => {
    streaming?.ready()
    if (!streaming && position > 0) {
      media.currentTime = position
    }
  }
  media.onerror = () => streaming?.fail(new Error("media error"))
  media.onseeking = () => restart_at(media.currentTime)
  media.onplay = () => start()

  media.ontimeupdate = () => {
    const current = Math.round(media.currentTime * 1_000) / 1_000
    if (!Number.isFinite(current) || current === position) {
      return
    }
    position = current
    sync_position()
  }
  sync_position()

  if (subtitle) {
    subtitle.onerror = () => streaming?.fail(new Error("subtitle error"))
    subtitle.onload = () => streaming?.ready()
  }

  if (!streaming && media.dataset.src) {
    media.src = source_url(media)
    media.load()
  }
})()

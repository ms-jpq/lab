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

/** @param {SourceBuffer} buffer @param {() => void} update */
const update = async (buffer, update) => {
  const { promise, reject, resolve } =
    /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
  buffer.onupdateend = () => resolve(undefined)
  buffer.onerror = () => reject(new Error("MSE update failed"))

  try {
    update()
    await promise
  } finally {
    buffer.onupdateend = null
    buffer.onerror = null
  }
}

/** @param {SourceBuffer} buffer @param {Uint8Array} bytes */
const append = (buffer, bytes) =>
  update(buffer, () => buffer.appendBuffer(bytes))

/** @param {SourceBuffer} buffer @param {number} duration */
const clear = (buffer, duration) =>
  update(buffer, () => buffer.remove(0, duration))

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

void (async () => {
  const page_url = new URL(location.href)
  const duration = Number(media.dataset.duration)
  const restart = Symbol("restart")

  let position = Number(time_input.value)
  let requested = false
  let retry_delay = 1_000
  let controller = new AbortController()
  let request = () => {}

  /** @param {number} value */
  const source_time = (value) => String(Math.round(value * 1_000) / 1_000)

  const sync_position = () => {
    time_input.value = source_time(position)
    page_url.searchParams.set("t", time_input.value)
    history.replaceState(null, "", page_url)
  }

  /** @param {HTMLMediaElement | HTMLTrackElement} resource */
  const seek_source = (resource) => {
    const source = new URL(resource.dataset.src ?? resource.src, location.href)
    source.searchParams.set("t", time_input.value)
    if (resource === media && mse) {
      resource.dataset.src = source.toString()
    } else {
      resource.src = source.toString()
    }
  }

  /** @param {number} target */
  const restart_at = (target) => {
    if (!Number.isFinite(target)) {
      return
    }
    position = target
    sync_position()
    if (subtitle) {
      seek_source(subtitle)
    }
    if (mse) {
      requested = true
      seek_source(media)
      controller.abort(restart)
    }
  }

  /** @param {unknown} error */
  const failure = (error) => {
    if (mse) {
      controller.abort(error)
    }
  }

  sync_position()

  media.ontimeupdate = () => {
    const current = Number(source_time(media.currentTime))
    if (!Number.isFinite(current) || current === position) {
      return
    }
    position = current
    sync_position()
  }
  media.onplay = () => {
    requested = true
    request()
  }
  media.onloadedmetadata = () => {
    retry_delay = 1_000
    if (!mse && position > 0) {
      media.currentTime = position
    }
  }
  media.onseeking = () => {
    const target = media.currentTime
    if (Math.abs(target - position) >= 0.001) {
      restart_at(target)
    }
  }
  media.onerror = () => failure(new Error("media error"))

  if (subtitle) {
    subtitle.onerror = () => failure(new Error("subtitle error"))
    subtitle.onload = () => {
      retry_delay = 1_000
    }
    subtitle.src = subtitle.dataset.src ?? subtitle.src
  }

  if (!mse) {
    if (media.dataset.src) {
      media.src = media.dataset.src
      media.load()
    }
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
  mse.onsourceopen = () => opened.resolve(undefined)
  media.src = URL.createObjectURL(mse)
  media.load()
  await opened.promise
  mse.onsourceopen = null

  const end = Number.isFinite(duration) && duration > 0 ? duration : 2 ** 53
  mse.duration = end
  const buffer = mse.addSourceBuffer(type)
  buffer.timestampOffset = position
  media.currentTime = position

  let replace = false
  for (;;) {
    const current = new AbortController()
    controller = current

    try {
      if (mse.readyState === "ended") {
        mse.duration = end
      }
      if (replace) {
        await clear(buffer, end)
      }
      replace = true
      buffer.timestampOffset = position

      const waiting = /** @type {PromiseWithResolvers<void>} */ (
        Promise.withResolvers()
      )
      request = () => waiting.resolve(undefined)
      if (requested) {
        request()
      }
      await waiting.promise
      current.signal.throwIfAborted()

      const url = media.dataset.src
      if (url === undefined) {
        throw new Error("missing MSE source")
      }
      for await (const bytes of fetch_stream(url, current)) {
        await append(buffer, bytes)
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
      if (controller === current) {
        request = () => {}
      }
    }
  }
})()

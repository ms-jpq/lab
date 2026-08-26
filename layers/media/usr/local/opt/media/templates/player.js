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

const page_url = new URL(location.href)
const duration = Number(media.dataset.duration)
const transformed = media.dataset.transformed === "true"
const RESTART = Symbol("restart")

let position = Number(time_input.value)
let expected_position = Number.NaN
let requested = false
let replacing = transformed
let retry_delay = 1_000
/** @type {AbortController | undefined} */
let controller
let request = () => {}

/** @param {number} value */
const source_time = (value) => String(Math.round(value * 1_000) / 1_000)

/** @param {number} value */
const set_position = (value) => {
  expected_position = value
  media.currentTime = value
}

/** @param {number} delay */
const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))

/** @param {SourceBuffer} buffer @param {Uint8Array} bytes */
const append = async (buffer, bytes) => {
  const { promise, reject, resolve } =
    /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())
  buffer.onupdateend = () => resolve(undefined)
  buffer.onerror = () => reject()
  buffer.appendBuffer(bytes)
  try {
    await promise
  } finally {
    buffer.onupdateend = null
    buffer.onerror = null
  }
}

/** @param {string} url @param {AbortController} controller */
const fetch_stream = async function* (url, controller) {
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok || response.body === null) {
      throw new Error("stream request failed")
    }
    yield* response.body
  } finally {
    controller.abort()
  }
}

/** @param {HTMLMediaElement | HTMLTrackElement} resource */
const seek_source = (resource) => {
  const source = new URL(resource.dataset.src ?? resource.src, location.href)
  source.searchParams.set("t", time_input.value)
  if (resource === media && transformed) {
    resource.dataset.src = source.toString()
  } else {
    resource.src = source.toString()
  }
}

const sync_position = () => {
  time_input.value = source_time(position)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
}

const current_position = () => Number(source_time(media.currentTime))

const restart_at = ({ target = media.currentTime } = {}) => {
  if (!Number.isFinite(target)) {
    return
  }
  position = target
  sync_position()
  if (!transformed) {
    set_position(target)
    return
  }
  requested = true
  replacing = true
  seek_source(media)
  if (subtitle) {
    seek_source(subtitle)
  }
  controller?.abort(RESTART)
}

/** @param {AbortController} current */
const main_stream = async (current) => {
  const type = media.dataset.mseType
  const url = media.dataset.src
  if (
    type === undefined ||
    !MediaSource.isTypeSupported(type) ||
    url === undefined
  ) {
    throw new Error("unsupported MSE source")
  }

  const source = new MediaSource()
  const object_url = URL.createObjectURL(source)
  const { promise, reject, resolve } =
    /** @type {PromiseWithResolvers<void>} */ (Promise.withResolvers())

  current.signal.onabort = () => reject(current.signal.reason)
  source.onsourceopen = async () => {
    try {
      current.signal.throwIfAborted()
      if (Number.isFinite(duration) && duration > 0) {
        source.duration = duration
      }
      const buffer = source.addSourceBuffer(type)
      buffer.timestampOffset = position
      set_position(position)
      replacing = false

      const waiting = /** @type {PromiseWithResolvers<void>} */ (
        Promise.withResolvers()
      )
      request = () => waiting.resolve(undefined)
      if (requested) {
        request()
      }
      await waiting.promise
      current.signal.onabort = null
      current.signal.throwIfAborted()

      for await (const bytes of fetch_stream(url, current)) {
        await append(buffer, bytes)
      }
      if (source.readyState === "open") {
        source.endOfStream()
      }
      resolve(undefined)
    } catch (error) {
      reject(error)
    } finally {
      current.signal.onabort = null
      source.onsourceopen = null
      if (controller === current) {
        request = () => {}
      }
    }
  }
  media.src = object_url
  media.load()
  await promise
}

/** @param {unknown} error */
const failure = (error) => {
  if (transformed && !replacing) {
    controller?.abort(error)
  }
}

sync_position()

{
  media.ontimeupdate = () => {
    const current = current_position()
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
    if (!transformed && position > 0) {
      set_position(position)
    }
  }
  media.onseeking = () => {
    const current = media.currentTime
    if (!transformed || replacing) {
      return
    }
    if (Math.abs(current - expected_position) < 0.001) {
      expected_position = Number.NaN
      return
    }
    expected_position = Number.NaN
    restart_at({ target: current })
  }
  media.onerror = () => failure(new Error("media error"))
}

if (subtitle) {
  subtitle.onerror = () => failure(new Error("subtitle error"))
  subtitle.onload = () => {
    retry_delay = 1_000
  }
  subtitle.src = subtitle.dataset.src ?? subtitle.src
}

if (transformed) {
  void (async () => {
    for (;;) {
      const current = new AbortController()
      controller = current
      try {
        await main_stream(current)
        return
      } catch (error) {
        if (current.signal.reason === RESTART) {
          continue
        }
        console.error(error)
        await sleep(retry_delay)
        retry_delay = Math.min(retry_delay * 2, 8_000)
      }
    }
  })()
} else if (media.dataset.src) {
  media.src = media.dataset.src
  media.load()
}

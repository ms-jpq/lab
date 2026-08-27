const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)
const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)
const time_input = /** @type {HTMLInputElement} */ (
  document.querySelector("form")?.elements.namedItem("t")
)

const MAX_PLAY_BEHIND = 30
const MAX_PAUSE_AHEAD = 30
const MAX_PLAY_AHEAD = 60
const RETRY_DELAY = 1_000

const media_source = () => {
  const { ManagedMediaSource } =
    /** @type {typeof globalThis & { ManagedMediaSource?: typeof MediaSource }} */ (
      globalThis
    )
  return new (ManagedMediaSource ?? MediaSource)()
}

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

  /** @param {AbortSignal} signal @param {Uint8Array} bytes */
  const append = async (signal, bytes) => {
    const end = media.currentTime - MAX_PLAY_BEHIND
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

/** @param {number | string} time */
const reload_subtitle = (time) => {
  if (!subtitle) {
    return
  }
  const source = new URL(source_url(subtitle, time))
  source.searchParams.set("retry", crypto.randomUUID())
  subtitle.src = source.toString()
}

/** @param {AbortSignal} signal @param {number} time */
const source_stream = async function* (signal, time) {
  signal.throwIfAborted()
  const controller = new AbortController()

  try {
    const response = await fetch(source_url(media, time), {
      signal: AbortSignal.any([signal, controller.signal]),
    })
    const reader = response.body?.getReader()
    if (!response.ok || !reader) {
      throw new Error(`${response.statusText} ${response.status}`)
    }
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          return
        }
        yield value
      }
    } finally {
      try {
        await reader.cancel()
      } finally {
        reader.releaseLock()
      }
    }
  } finally {
    controller.abort()
  }
}

/** @param {AbortSignal} signal @param {ReturnType<typeof mse_buffer>} buffer @param {number} time @param {() => Promise<void>} wait */
const resumable_stream = async function* (signal, buffer, time, wait) {
  const buffered = () =>
    buffer.play_ahead(media.currentTime) >=
    (media.paused ? MAX_PAUSE_AHEAD : MAX_PLAY_AHEAD)

  l1: for (;;) {
    while (buffered()) {
      await wait()
      signal.throwIfAborted()
    }

    const start = buffer.frontier() ?? time
    buffer.seek(start)
    for await (const bytes of source_stream(signal, start)) {
      yield bytes
      if (buffered()) {
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
  let buffer
  let can_seek = false
  let wake = Promise.withResolvers()
  let restored_time = Number.NaN

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
          restored_time = time
          media.currentTime = time
        }

        await buffer.prepare(signal, time)
        can_seek = true
        reload_subtitle(time)
        for await (const bytes of resumable_stream(
          signal,
          buffer,
          time,
          wait,
        )) {
          await buffer.append(signal, bytes)
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
        restored_time = Number.NaN
        controller.abort()
        controller = new AbortController()
      }

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    }
  }

  /** @param {boolean} seeking @param {number} time */
  const update = (seeking, time) => {
    if (seeking && time === restored_time) {
      restored_time = Number.NaN
      return false
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

  return { retry, stop, resume, run, update }
}

const streaming = media.dataset.transformed === "true" ? stream() : undefined

if (subtitle) {
  subtitle.onerror = () => streaming?.retry()
}

const initial_position = Number(time_input.value)

if (!streaming) {
  media.src = source_url(media, media.currentTime)
  media.load()
  media.addEventListener(
    "loadedmetadata",
    () => {
      if (initial_position > 0) {
        media.currentTime = initial_position
      }
    },
    { once: true },
  )
}

media.onerror = () => {
  if (media.error?.code !== MediaError.MEDIA_ERR_ABORTED) {
    streaming?.retry()
  }
}

media.onplay = () => streaming?.resume()

media.onseeking = () => {
  const target = media.currentTime
  if (!Number.isFinite(target)) {
    return
  }
  if (streaming && !streaming.update(true, target)) {
    return
  }
  set_position(target)
}

media.ontimeupdate = () => {
  const current = Math.round(media.currentTime * 1_000) / 1_000
  if (!Number.isFinite(current)) {
    return
  }
  if (streaming && !streaming.update(false, current)) {
    return
  }
  set_position(current)
}

media.currentTime = initial_position
set_position(initial_position)
streaming?.run()

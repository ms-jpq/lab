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

/** @param {EventTarget} target @param {AbortSignal | undefined} signal @param {string} type @returns {Promise<Event>} */
const once = (target, signal, type) =>
  new Promise((resolve, reject) => {
    signal?.throwIfAborted()

    const abort = () => reject(signal?.reason)
    const complete = (/** @type {Event} */ event) => {
      signal?.removeEventListener("abort", abort)
      resolve(event)
    }
    signal?.addEventListener("abort", abort, { once: true })
    target.addEventListener(type, complete, { once: true, signal })
  })

/** @param {EventTarget} target @param {AbortSignal | undefined} signal @param {string} type @returns {AsyncIteratorObject<Event>} */
const events = (target, signal, type) => {
  signal?.throwIfAborted()
  let cleanup = () => {}
  const stream = new ReadableStream(
    /** @type {UnderlyingDefaultSource<Event>} */ ({
      start: (controller) => {
        const receive = (/** @type {Event} */ event) =>
          controller.enqueue(event)
        const abort = () => controller.error(signal?.reason)
        cleanup = () => {
          target.removeEventListener(type, receive)
          signal?.removeEventListener("abort", abort)
        }
        signal?.addEventListener("abort", abort, { once: true })
        target.addEventListener(type, receive, { signal })
      },
      cancel: () => cleanup(),
    }),
  )
  return stream.values()
}

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
  const operation = new AbortController()
  const events_signal = AbortSignal.any([signal, operation.signal])

  const updated = once(buffer, events_signal, "updateend")
  const failed = (async () => {
    throw await once(buffer, events_signal, "error")
  })()
  const aborted = (async () => {
    await once(signal, operation.signal, "abort")
    if (mse.readyState === "open" && buffer.updating) {
      buffer.abort()
    }
  })()

  try {
    yield
    await Promise.race([updated, failed, aborted])
    signal.throwIfAborted()
  } finally {
    operation.abort()
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
  const seek = (position) => {
    buffer.abort()
    buffer.timestampOffset = position
  }

  return {
    frontier,
    /** @param {number} position */
    contains: (position) => {
      const ranges = buffer.buffered
      for (let index = 0; index < ranges.length; index += 1) {
        if (ranges.start(index) <= position && position <= ranges.end(index)) {
          return true
        }
      }
      return false
    },
    /** @param {number} position */
    play_ahead: (position) => (frontier() ?? position) - position,
    /** @param {AbortSignal} signal @param {number} position @param {Uint8Array} bytes */
    append: async (signal, position, bytes) => {
      const end = position - BUFFER.BEHIND
      if (end > 0 && buffer.buffered.length && buffer.buffered.start(0) < end) {
        for await (const _ of mse_buffer_update(signal, mse, buffer)) {
          buffer.remove(0, end)
        }
      }
      for await (const _ of mse_buffer_update(signal, mse, buffer)) {
        buffer.appendBuffer(new Uint8Array(bytes))
      }
    },
    seek,
    /** @param {AbortSignal} signal @param {number} position */
    prepare: async (signal, position) => {
      signal.throwIfAborted()
      const duration = mse.duration
      if (buffer.buffered.length && Number.isFinite(duration)) {
        for await (const _ of mse_buffer_update(signal, mse, buffer)) {
          buffer.remove(0, duration)
        }
      }
      seek(position)
    },
    end: () => {
      if (mse.readyState === "open") {
        mse.endOfStream()
      }
    },
  }
}

/** @param {AbortSignal} signal */
const open_mse = async (signal) => {
  signal.throwIfAborted()
  const mse = media_source()
  const type = /** @type {string} */ (media.dataset.mseType)
  const duration = Number(media.dataset.duration)

  media.src = URL.createObjectURL(mse)
  await once(mse, signal, "sourceopen")
  if (Number.isFinite(duration) && duration > 0) {
    mse.duration = duration
  }
  return mse_buffer(mse, type)
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
      throw new Error(`${response.statusText} - ${response.status}`)
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

  /** @param {unknown} reason */
  const stop = (reason) => {
    controller.abort(reason)
    resume()
  }

  return {
    /** @param {boolean} seeking @param {number} time */
    accept_position: (seeking, time) => {
      if (!seeking && !can_seek) {
        return false
      }
      if (seeking) {
        if (restored_position !== undefined) {
          const restored = time === restored_position
          restored_position = undefined
          if (restored) {
            return false
          }
        }
        if (!can_seek || !buffer?.contains(time)) {
          can_seek = false
          stop(restart)
          return true
        }
      }
      resume()
      return true
    },
    retry: () => {
      if (can_seek) {
        stop(retrying)
      }
    },
    stop,
    resume,
    run: async () => {
      for (;;) {
        can_seek = false
        const { signal } = controller
        const time = Number(time_input.value)

        try {
          if (buffer === undefined) {
            buffer = await open_mse(signal)
            if (media.currentTime !== time) {
              media.currentTime = restored_position = time
            }
          }

          await buffer.prepare(signal, time)
          for await (const bytes of resumable_stream(
            signal,
            buffer,
            time,
            async () => {
              await wake.promise
              wake = Promise.withResolvers()
            },
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
    },
  }
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
  void (async () => {
    const loaded = once(media, undefined, "loadedmetadata")
    media.src = source_url(media, media.currentTime)
    media.load()
    await loaded
    if (initial_position > 0) {
      media.currentTime = initial_position
    }
  })()
}

media.onerror = () => {
  if (media.error?.code !== MediaError.MEDIA_ERR_ABORTED) {
    streaming?.retry()
  }
}

void (async () => {
  for await (const _ of events(media, undefined, "play")) {
    streaming?.resume()
    if (media.readyState >= media.HAVE_FUTURE_DATA) {
      continue
    }

    media.pause()
    await once(media, undefined, "canplay")
    await media.play()
  }
})()

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

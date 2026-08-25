const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)

const form = /** @type {HTMLFormElement} */ (document.querySelector("form"))

const time_input = /** @type {HTMLInputElement} */ (
  form.elements.namedItem("t")
)

const scrubber = /** @type {HTMLInputElement} */ (
  document.querySelector("#scrubber")
)

const current_time_output = /** @type {HTMLOutputElement} */ (
  document.querySelector("#current-time")
)

const remaining_time_output = /** @type {HTMLOutputElement} */ (
  document.querySelector("#remaining-time")
)

const buffered_time_output = /** @type {HTMLOutputElement} */ (
  document.querySelector("#buffered-time")
)

const loading_speed_output = /** @type {HTMLOutputElement} */ (
  document.querySelector("#loading-speed")
)

const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)

const playback = /** @type {HTMLButtonElement} */ (
  document.querySelector("#playback")
)

const fullscreen = /** @type {HTMLButtonElement} */ (
  document.querySelector("#fullscreen")
)

const page_url = new URL(location.href)
const transformed = scrubber.dataset.transformed === "true"

let start = Number(time_input.value)
let position = start
let loaded = false

const format_time = (value = 0) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const minutes = Math.floor(seconds / 60)
  const clock = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  return minutes < 60
    ? `${minutes}:${clock.slice(3)}`
    : `${Math.floor(minutes / 60)}:${clock}`
}

/** @param {number} value */
const source_time = (value) => String(Math.round(value * 1_000) / 1_000)

/** @param {number} value */
const show_position = (value) => {
  current_time_output.value = format_time(value)
  remaining_time_output.value = `-${format_time(Number(scrubber.max) - value)}`
}

/** @param {HTMLMediaElement | HTMLTrackElement} resource */
const seek_source = (resource) => {
  const source = new URL(resource.dataset.src ?? resource.src, location.href)
  source.searchParams.set("t", time_input.value)
  resource.src = source.toString()
}

const load_media = () => {
  if (loaded || media.dataset.src === undefined) {
    return
  }
  loaded = true
  media.src = media.dataset.src
  if (subtitle && subtitle.dataset.src) {
    subtitle.src = subtitle.dataset.src
  }
  media.load()
}

const play_media = () => {
  load_media()
  media.play().catch(() => {})
}

const toggle_playback = () => {
  if (media.paused) {
    play_media()
  } else {
    media.pause()
  }
}

const toggle_fullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
    return
  }
  if (media instanceof HTMLVideoElement) {
    const video =
      /** @type {HTMLVideoElement & { webkitEnterFullscreen?: () => void }} */ (
        media
      )
    if (typeof video.webkitEnterFullscreen === "function") {
      video.webkitEnterFullscreen()
      return
    }
  }
  media.requestFullscreen().catch(() => {})
}

/** @param {KeyboardEvent} event */
const keyboard_control = (event) => {
  if (
    event.repeat ||
    event.target instanceof HTMLInputElement ||
    event.target instanceof HTMLSelectElement ||
    event.target instanceof HTMLButtonElement
  ) {
    return
  }
  if (event.code === "Space") {
    event.preventDefault()
    toggle_playback()
    return
  }
  if (event.code === "Enter") {
    event.preventDefault()
    toggle_fullscreen()
  }
}

const sync_position = () => {
  time_input.value = source_time(position)
  show_position(position)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
}

const sync_buffer = (() => {
  let previous_end = Number.NaN
  let previous_at = performance.now()

  return () => {
    const { buffered, currentTime } = media
    let end
    for (let index = 0; index < buffered.length; index += 1) {
      const start = buffered.start(index)
      const candidate = buffered.end(index)
      if (start <= currentTime && currentTime <= candidate) {
        end = candidate
        break
      }
    }
    buffered_time_output.value = `+${Math.floor((end ?? currentTime) - currentTime)}s`

    const now = performance.now()
    const speed =
      end === undefined || !Number.isFinite(previous_end)
        ? 0
        : Math.max(0, ((end - previous_end) * 1_000) / (now - previous_at))
    loading_speed_output.value = `${speed.toFixed(1)}×`
    previous_end = end ?? Number.NaN
    previous_at = now
  }
})()

const current_position = () =>
  Number(source_time(media.currentTime + (transformed ? start : 0)))

const update_position = () => {
  const current = current_position()
  if (!Number.isFinite(current) || current === position) {
    return
  }
  position = current
  scrubber.value = String(position)
  sync_position()
}

const preview_position = () => {
  const target = Number(scrubber.value)
  if (!Number.isFinite(target)) {
    return
  }
  show_position(target)
}

const seek = ({
  target = Number(scrubber.value),
  playing = !media.paused,
  reset = true,
  reload = false,
} = {}) => {
  if (!Number.isFinite(target)) {
    return
  }
  if (reset) {
    recovery.reset()
  }
  position = target
  sync_position()
  if (!transformed) {
    if (reload) {
      loaded = false
    }
    load_media()
    media.currentTime = target
  } else {
    loaded = true
    start = target
    seek_source(media)
    if (subtitle) {
      seek_source(subtitle)
    }
    media.load()
  }
  if (playing) {
    play_media()
  }
}

/** @param {() => void} restart */
const retry = (restart) => {
  let attempts = 0
  /** @type {number | undefined} */
  let timer

  const reset = () => {
    attempts = 0
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const schedule = () => {
    if (timer !== undefined || attempts === 4) {
      return
    }
    attempts += 1
    timer = setTimeout(
      () => {
        timer = undefined
        restart()
      },
      1_000 * 2 ** (attempts - 1),
    )
  }

  return { reset, schedule }
}

let media_ready = false
let subtitle_ready = subtitle === null

const recovery = retry(() => {
  const position = current_position()
  if (!Number.isFinite(position)) {
    return
  }
  media_ready = false
  subtitle_ready = subtitle === null
  seek({ target: position, playing: !media.paused, reset: false, reload: true })
})

const recover = () => {
  recovery.schedule()
}

const reset_recovery = () => {
  if (media_ready && subtitle_ready) {
    recovery.reset()
  }
}

sync_position()
sync_buffer()

media.addEventListener("timeupdate", update_position)
media.addEventListener("timeupdate", sync_buffer)
media.addEventListener("progress", sync_buffer)
media.addEventListener("loadedmetadata", () => {
  media_ready = true
  reset_recovery()
  if (!transformed && position > 0) {
    media.currentTime = position
  }
})
media.addEventListener("error", () => {
  media_ready = false
  recover()
})
if (subtitle) {
  subtitle.addEventListener("error", () => {
    subtitle_ready = false
    recover()
  })
  subtitle.addEventListener("load", () => {
    subtitle_ready = true
    reset_recovery()
  })
}
scrubber.addEventListener("input", preview_position)
scrubber.addEventListener("change", () => seek())
media.addEventListener("click", toggle_playback)
playback.addEventListener("click", toggle_playback)
fullscreen.addEventListener("click", toggle_fullscreen)
document.addEventListener("keydown", keyboard_control)

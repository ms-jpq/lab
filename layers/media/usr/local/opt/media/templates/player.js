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
let attempts = 0
let loaded = false
let buffered_end = Number.NaN
let buffered_at = performance.now()
/** @type {number | undefined} */
let retry_timer

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

const toggle_playback = () => {
  if (media.paused) {
    load_media()
    media.play().catch(() => {})
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

const sync_position = () => {
  time_input.value = source_time(position)
  current_time_output.value = format_time(position)
  remaining_time_output.value = `-${format_time(Number(scrubber.max) - position)}`
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
}

const sync_buffer = () => {
  const { buffered, currentTime } = media
  const end = Array.from({ length: buffered.length }, (_, index) => {
    const start = buffered.start(index)
    const end = buffered.end(index)
    return start <= currentTime && currentTime <= end ? end : undefined
  }).find((end) => end !== undefined)
  buffered_time_output.value = `+${Math.floor((end ?? currentTime) - currentTime)}s`

  const now = performance.now()
  if (
    end === undefined ||
    !Number.isFinite(buffered_end) ||
    end < buffered_end
  ) {
    buffered_end = end ?? Number.NaN
    buffered_at = now
    loading_speed_output.value = ""
    return
  }
  if (end === buffered_end) {
    return
  }
  loading_speed_output.value = `${(((end - buffered_end) * 1_000) / (now - buffered_at)).toFixed(1)}×`
  buffered_end = end
  buffered_at = now
}

const update_position = () => {
  const current = Number(
    source_time(media.currentTime + (transformed ? start : 0)),
  )
  if (!Number.isFinite(current) || current === position) {
    return
  }
  attempts = 0
  position = current
  scrubber.value = String(position)
  sync_position()
}

const preview_position = () => {
  const target = Number(scrubber.value)
  if (!Number.isFinite(target)) {
    return
  }
  current_time_output.value = format_time(target)
  remaining_time_output.value = `-${format_time(Number(scrubber.max) - target)}`
}

const seek = ({ playing = !media.paused, reset = true } = {}) => {
  const target = Number(scrubber.value)
  if (!Number.isFinite(target)) {
    return
  }
  if (retry_timer !== undefined) {
    clearTimeout(retry_timer)
    retry_timer = undefined
  }
  if (reset) {
    attempts = 0
  }
  position = target
  sync_position()
  if (!transformed) {
    load_media()
    media.currentTime = target
    return
  }
  loaded = true
  start = target
  seek_source(media)
  if (subtitle) {
    seek_source(subtitle)
  }
  media.load()
  if (playing) {
    media.play().catch(() => {})
  }
}

const retry_stream = () => {
  if (!transformed || retry_timer !== undefined || attempts === 4) {
    return
  }
  attempts += 1
  retry_timer = setTimeout(
    () => {
      retry_timer = undefined
      seek({ playing: true, reset: false })
    },
    1_000 * 2 ** (attempts - 1),
  )
}

sync_position()
sync_buffer()

media.addEventListener("timeupdate", update_position)
media.addEventListener("timeupdate", sync_buffer)
media.addEventListener("progress", sync_buffer)
media.addEventListener("loadedmetadata", () => {
  if (!transformed && position > 0) {
    media.currentTime = position
  }
})
media.addEventListener("error", retry_stream)
scrubber.addEventListener("input", preview_position)
scrubber.addEventListener("change", () => seek())
media.addEventListener("click", toggle_playback)
playback.addEventListener("click", toggle_playback)
fullscreen.addEventListener("click", toggle_fullscreen)

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

const total_time_output = /** @type {HTMLOutputElement} */ (
  document.querySelector("#total-time")
)

const playback_button = /** @type {HTMLButtonElement} */ (
  document.querySelector("#playback")
)

const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)

const page_url = new URL(location.href)
const transformed = scrubber.dataset.transformed === "true"

let start = Number(time_input.value)
let position = start
let attempts = 0
let retry_timer = undefined

const format_time = (value = 0) => {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  const minutes = Math.floor(seconds / 60)
  const clock = `${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
  return minutes < 60
    ? `${minutes}:${clock.slice(3)}`
    : `${Math.floor(minutes / 60)}:${clock}`
}

const play = () => {
  if (media.paused) {
    media.play().catch(() => {})
  } else {
    media.pause()
  }
}

const fullscreen = () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
  } else {
    document.documentElement.requestFullscreen().catch(() => {})
  }
}

const update_playback = () => {
  playback_button.textContent = media.paused ? "Play" : "Pause"
}

const sync_position = () => {
  time_input.value = String(position)
  current_time_output.value = format_time(position)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
}

const update_position = () => {
  const current = Math.floor(media.currentTime + (transformed ? start : 0))
  if (!Number.isFinite(current) || current === position) {
    return
  }
  attempts = 0
  position = current
  scrubber.value = String(position)
  sync_position()
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
    media.currentTime = target
    return
  }
  start = target
  const source = new URL(media.src)
  source.searchParams.set("t", time_input.value)
  media.src = source.toString()
  if (subtitle) {
    const source = new URL(subtitle.src)
    source.searchParams.set("t", time_input.value)
    subtitle.src = source.toString()
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
  playback_button.textContent = `Retry ${attempts}/4`
  retry_timer = setTimeout(
    () => {
      retry_timer = undefined
      seek({ playing: true, reset: false })
    },
    1_000 * 2 ** (attempts - 1),
  )
}

total_time_output.value = format_time(Number(scrubber.max))
sync_position()

media.addEventListener("timeupdate", update_position)
media.addEventListener("play", update_playback)
media.addEventListener("pause", update_playback)
media.addEventListener("loadedmetadata", () => {
  if (!transformed && position > 0) {
    media.currentTime = position
  }
})
media.addEventListener("error", retry_stream)
scrubber.addEventListener("change", () => seek())
playback_button.addEventListener("click", play)
media.addEventListener("click", play)
media.addEventListener("dblclick", fullscreen)

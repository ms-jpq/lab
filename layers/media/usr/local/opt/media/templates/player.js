const media = /** @type {HTMLMediaElement} */ (
  document.querySelector("video, audio")
)

const form = /** @type {HTMLFormElement} */ (document.querySelector("form"))

const time = /** @type {HTMLInputElement} */ (form.elements.namedItem("t"))

const scrubber = /** @type {HTMLInputElement} */ (
  document.querySelector("#scrubber")
)

const current_time = /** @type {HTMLOutputElement} */ (
  document.querySelector("#current-time")
)

const total_time = /** @type {HTMLOutputElement} */ (
  document.querySelector("#total-time")
)

const playback = /** @type {HTMLButtonElement} */ (
  document.querySelector("#playback")
)

const subtitle = /** @type {HTMLTrackElement | null} */ (
  document.querySelector("#subtitle")
)

const url = new URL(location.href)
const transformed = scrubber.dataset.transformed === "true"

let offset = Number(time.value)
let position = offset

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

const update_playback = () => {
  playback.textContent = media.paused ? "Play" : "Pause"
}

const sync = () => {
  time.value = String(position)
  current_time.value = format_time(position)
  url.searchParams.set("t", time.value)
  history.replaceState(null, "", url)
}

const update = () => {
  const current = Math.floor(media.currentTime + (transformed ? offset : 0))
  if (!Number.isFinite(current) || current === position) {
    return
  }
  position = current
  scrubber.value = String(position)
  sync()
}

const restart = () => {
  const target = Number(scrubber.value)
  if (!Number.isFinite(target)) {
    return
  }
  const playing = !media.paused
  position = target
  sync()
  if (!transformed) {
    media.currentTime = target
    return
  }
  offset = target
  const source = new URL(media.src)
  source.searchParams.set("t", time.value)
  media.src = source.toString()
  if (subtitle) {
    const source = new URL(subtitle.src)
    source.searchParams.set("t", time.value)
    subtitle.src = source.toString()
  }
  media.load()
  if (playing) {
    media.play().catch(() => {})
  }
}

total_time.value = format_time(Number(scrubber.max))
sync()

media.addEventListener("timeupdate", update)
media.addEventListener("play", update_playback)
media.addEventListener("pause", update_playback)
media.addEventListener("loadedmetadata", () => {
  if (!transformed && position > 0) {
    media.currentTime = position
  }
})
scrubber.addEventListener("change", restart)
playback.addEventListener("click", play)
media.addEventListener("click", play)

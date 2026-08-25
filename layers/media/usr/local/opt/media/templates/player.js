const media = document.querySelector("video, audio")
if (!(media instanceof HTMLMediaElement)) {
  throw Error("media")
}

const form = document.querySelector("form")
if (!(form instanceof HTMLFormElement)) {
  throw Error("form")
}

const time = form.elements.namedItem("t")
if (!(time instanceof HTMLInputElement)) {
  throw Error("t")
}

const scrubber = document.querySelector("#scrubber")
if (!(scrubber instanceof HTMLInputElement)) {
  throw Error("scrubber")
}

const current_time = document.querySelector("#current-time")
if (!(current_time instanceof HTMLOutputElement)) {
  throw Error("current-time")
}

const total_time = document.querySelector("#total-time")
if (!(total_time instanceof HTMLOutputElement)) {
  throw Error("total-time")
}

const playback = document.querySelector("#playback")
if (!(playback instanceof HTMLButtonElement)) {
  throw Error("playback")
}

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

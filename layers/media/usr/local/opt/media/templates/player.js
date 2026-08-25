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

const url = new URL(location.href)
const transformed = scrubber.dataset.transformed === "true"

let offset = Number(time.value)
let position = offset

const sync = () => {
  time.value = String(position)
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

media.addEventListener("timeupdate", update)
media.addEventListener("loadedmetadata", () => {
  if (!transformed && position > 0) {
    media.currentTime = position
  }
})
scrubber.addEventListener("change", restart)

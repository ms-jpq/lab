const media = document.querySelector("video, audio")
const form = document.querySelector("form")
const time = form?.elements.t
const scrubber = document.querySelector("#scrubber")
const url = new URL(location.href)
let offset = Number(time.value)
let previous = offset

const update = () => {
  const current = Math.floor(media.currentTime + (scrubber ? offset : 0))
  if (!Number.isFinite(current) || current === previous) return
  previous = current
  time.value = String(current)
  if (scrubber) scrubber.value = time.value
  url.searchParams.set("t", time.value)
  history.replaceState(null, "", url)
}

const viewport = () => {
  form.elements.width.value = String(innerWidth)
  form.elements.height.value = String(innerHeight)
  form.elements.dpr.value = String(devicePixelRatio)
}

const restart = () => {
  const target = Number(scrubber.value)
  if (!Number.isFinite(target)) return
  const playing = !media.paused
  offset = target
  previous = target
  time.value = String(target)
  url.searchParams.set("t", time.value)
  history.replaceState(null, "", url)
  const source = new URL(media.src)
  source.searchParams.set("t", time.value)
  media.src = source.toString()
  media.load()
  if (playing) media.play().catch(() => {})
}

media.addEventListener("timeupdate", update)
media.addEventListener("loadedmetadata", () => {
  if (!scrubber && previous > 0) media.currentTime = previous
})
scrubber?.addEventListener("change", restart)

viewport()

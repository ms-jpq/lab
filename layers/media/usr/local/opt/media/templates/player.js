const media = document.querySelector("video, audio")
const form = document.querySelector("form")
const time = form?.elements.t
const url = new URL(location.href)
let previous = Number(url.searchParams.get("t") ?? 0)

const update = () => {
  const current = Math.floor(media.currentTime)
  if (!Number.isFinite(current) || current === previous) return
  previous = current
  time.value = String(current)
  url.searchParams.set("t", time.value)
  history.replaceState(null, "", url)
}

const viewport = () => {
  form.elements.width.value = String(innerWidth)
  form.elements.height.value = String(innerHeight)
  form.elements.dpr.value = String(devicePixelRatio)
}

media.addEventListener("timeupdate", update)
media.addEventListener("loadedmetadata", () => {
  if (previous > 0) media.currentTime = previous
})

viewport()

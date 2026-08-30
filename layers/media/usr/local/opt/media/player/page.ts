import { playable_position } from "./media.ts"
import { abortion, delay, once } from "./util.ts"

const POSITION = `media:position:${location.pathname}`
const PAGE = crypto.randomUUID()

export const media = document.querySelector("video, audio") as HTMLMediaElement
export const mime_type = media.dataset["mseType"] as string
const subtitle = document.querySelector<HTMLTrackElement>("#subtitle")
const form = document.querySelector("form") as HTMLFormElement
const time_input = form.elements.namedItem("t") as HTMLInputElement

export const page_position = (): number =>
  playable_position(media, Number(time_input.value))

const initial_position: number = (() => {
  if (new URL(location.href).searchParams.has("t")) {
    return page_position()
  }
  try {
    const stored = Number(localStorage.getItem(POSITION))
    return playable_position(media, stored)
  } catch {
    return 0
  }
})()

export const persist_position = (value: number): void => {
  const page_url = new URL(location.href)
  const position = Math.floor(value)
  if (Number(time_input.value) === position) {
    return
  }
  time_input.value = String(position)
  page_url.searchParams.set("t", time_input.value)
  history.replaceState(null, "", page_url)
  try {
    localStorage.setItem(POSITION, time_input.value)
  } catch {}
}

export const source_url = (
  resource: HTMLMediaElement | HTMLTrackElement,
  time: number,
): string => {
  const path = resource.dataset["src"] as string
  const source = new URL(path, location.href)
  source.searchParams.set("t", String(time))
  source.searchParams.set("page", PAGE)
  source.searchParams.set("request", crypto.randomUUID())
  return source.toString()
}

const submit = (event: SubmitEvent): void => {
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

const play_subtitle = async (signal: AbortSignal): Promise<void> => {
  if (!subtitle || signal.aborted) {
    return
  }

  for (;;) {
    const event = await (async () => {
      using attempt = abortion(signal)
      const loaded = Promise.race([
        once(attempt.signal, subtitle, "load"),
        once(attempt.signal, subtitle, "error"),
      ])
      subtitle.src = source_url(subtitle, 0)
      return await loaded
    })()

    if (event?.type !== "error") {
      return
    }
    console.error(event)
    if (!(await delay(signal, 1_000))) {
      return
    }
  }
}

export const main = async (
  play_media: (signal: AbortSignal) => Promise<undefined | void>,
): Promise<never> => {
  form.onsubmit = submit
  persist_position(initial_position)

  for (;;) {
    using a = abortion()
    await once(a.signal, window, "pageshow")

    const hidden = once(a.signal, window, "pagehide")
    await Promise.race([
      hidden,
      play_media(a.signal),
      play_subtitle(a.signal).then(() => hidden),
    ])
  }
}

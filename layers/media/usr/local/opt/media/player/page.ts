import { playable_position } from "./reducer.ts"
import { abortion, delay, once } from "./util.ts"

const POSITION = `media:position:${location.pathname}`
const PAGE = crypto.randomUUID()

export const media = document.querySelector("video, audio") as HTMLMediaElement
export const subtitle = document.querySelector<HTMLTrackElement>("#subtitle")
export const form = document.querySelector("form") as HTMLFormElement
const time_input = form.elements.namedItem("t") as HTMLInputElement

export const page_position = (): number =>
  playable_position(media, Number(time_input.value))

export const initial_position: number = (() => {
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

export const submit = (event: SubmitEvent): void => {
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

export const play_subtitle = async (signal: AbortSignal): Promise<void> => {
  if (!subtitle || signal.aborted) {
    return
  }
  for (;;) {
    let event: Event | undefined
    {
      using attempt = abortion(signal)
      const loaded = Promise.race([
        once(attempt.signal, subtitle, "load"),
        once(attempt.signal, subtitle, "error"),
      ])
      subtitle.src = source_url(subtitle, 0)
      event = await loaded
    }
    if (event === undefined || event.type === "load") {
      return
    }
    console.error(event)
    if (!(await delay(signal, 1_000)) || signal.aborted) {
      return
    }
  }
}

export const run_playback = async (
  signal: AbortSignal,
  play_media: (signal: AbortSignal) => Promise<void>,
): Promise<void> => {
  using a = abortion(signal)
  const playback = play_media(a.signal)
  const captions = play_subtitle(a.signal).then(() => playback)
  try {
    await Promise.race([playback, captions])
  } finally {
    a[Symbol.dispose]()
    await Promise.allSettled([playback, captions])
  }
}

export const run_page = async (
  playback: (signal: AbortSignal) => Promise<void>,
): Promise<never> => {
  for (;;) {
    using a = abortion()
    await once(a.signal, window, "pageshow")
    const running = playback(a.signal)

    try {
      await Promise.race([once(a.signal, window, "pagehide"), running])
    } finally {
      a[Symbol.dispose]()
      await running
    }
  }
}

export const start_page = async (
  playback: (signal: AbortSignal) => Promise<void>,
): Promise<never> => {
  form.onsubmit = submit
  persist_position(initial_position)
  return await run_page(playback)
}

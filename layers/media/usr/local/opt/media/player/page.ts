import { playable_position } from "./media.ts"
import { abortion, once } from "./util.ts"

export type PlayerPage = {
  initial_position: number
  media: HTMLMediaElement
  page_position: () => number
  persist_position: (value: number) => void
  source_url: (
    resource: HTMLMediaElement | HTMLTrackElement,
    time: number,
  ) => string
  subtitle: HTMLTrackElement | null
  run: (playback: (signal: AbortSignal) => Promise<void>) => Promise<never>
}

export const player_page = (() => {
  const POSITION = `media:position:${location.pathname}`
  const PAGE = crypto.randomUUID()
  const media = document.querySelector("video, audio") as HTMLMediaElement
  const subtitle = document.querySelector<HTMLTrackElement>("#subtitle")
  const form = document.querySelector("form") as HTMLFormElement
  const time_input = form.elements.namedItem("t") as HTMLInputElement

  const page_position = (): number =>
    playable_position(media, Number(time_input.value))

  const initial_position = (() => {
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

  const persist_position = (value: number): void => {
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

  const source_url = (
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

  const run = async (
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

  form.onsubmit = submit

  return {
    initial_position,
    media,
    page_position,
    persist_position,
    run,
    source_url,
    subtitle,
  }
})() satisfies PlayerPage

import { abortion, once } from "./util.ts"

export type PlayerPage = {
  media: HTMLMediaElement
  subtitle: HTMLTrackElement | null
  time_input: HTMLInputElement
  run: (playback: (signal: AbortSignal) => Promise<void>) => Promise<never>
}

export const player_page = (() => {
  const media = document.querySelector("video, audio") as HTMLMediaElement
  const subtitle = document.querySelector<HTMLTrackElement>("#subtitle")
  const form = document.querySelector("form") as HTMLFormElement
  const time_input = form.elements.namedItem("t") as HTMLInputElement

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
      using lifetime = abortion()
      await once(lifetime.signal, window, "pageshow")
      const running = playback(lifetime.signal)

      try {
        await Promise.race([once(lifetime.signal, window, "pagehide"), running])
      } finally {
        lifetime[Symbol.dispose]()
        await running
      }
    }
  }

  form.onsubmit = submit

  return { media, subtitle, time_input, run }
})() satisfies PlayerPage

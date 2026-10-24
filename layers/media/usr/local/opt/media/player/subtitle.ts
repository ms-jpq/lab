import { defer, delay, once } from "./util.ts"

export const play_subtitle = async (
  subtitle: HTMLTrackElement,
  { signal, tracks }: { signal: AbortSignal; tracks: TextTrackList },
) => {
  for (; !signal.aborted; await delay(signal, 1_000)) {
    while (!signal.aborted && subtitle.track.mode === "disabled") {
      await once(signal, tracks, "change")
    }
    if (signal.aborted) {
      break
    }

    try {
      const source = new URL(subtitle.dataset["src"] as string, location.href)
      source.searchParams.set("request", crypto.randomUUID())
      const response = await fetch(source, { signal })
      if (!response.ok) {
        throw new Error(`Subtitle request failed: ${response.status}`)
      }
      const content = await response.blob()
      if (signal.aborted) {
        break
      }

      const url = URL.createObjectURL(content)
      using _ = defer(() => {
        subtitle.removeAttribute("src")
        URL.revokeObjectURL(url)
      })
      const failed = once(signal, subtitle, "error")
      subtitle.src = url
      const error = await failed
      if (error !== undefined) {
        throw error
      }
      break
    } catch (error) {
      if (signal.aborted) {
        break
      }
      console.error(error)
    }
  }
}

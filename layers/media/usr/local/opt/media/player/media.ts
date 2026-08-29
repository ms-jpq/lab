import type { EventOf } from "./util.ts"

export type MediaSnapshot = {
  ended: boolean
  metadata: boolean
  seeking: boolean
  time: number
}

const EVENTS = [
  "canplay",
  "ended",
  "error",
  "loadedmetadata",
  "progress",
  "seeked",
  "seeking",
  "timeupdate",
  "waiting",
] as const satisfies readonly (keyof HTMLMediaElementEventMap)[]

export type MediaEvent = EventOf<HTMLMediaElement, (typeof EVENTS)[number]>

export const media_snapshot = (media: HTMLMediaElement): MediaSnapshot => ({
  ended: media.ended,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

export const observe_media = (
  media: HTMLMediaElement,
  signal: AbortSignal,
  observe: (event: MediaEvent, snapshot: MediaSnapshot) => void,
): void => {
  for (const type of EVENTS) {
    media.addEventListener(
      type,
      (event) => observe(event, media_snapshot(media)),
      { signal },
    )
  }
}

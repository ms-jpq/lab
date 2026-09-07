import { event_batches } from "./util.ts"

export type MediaSnapshot = Readonly<{
  buffered: readonly (readonly [start: number, end: number])[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  paused: boolean
  seeking: boolean
  time: number
}>

export type MediaEvent = (typeof EVENTS)[number]

export type MediaAction = Readonly<{
  current: MediaSnapshot
  type: "buffered" | MediaEvent
}>

const END_TOLERANCE = 0.5
export const POSITION_TOLERANCE = 0.1

const EVENTS = [
  "canplay",
  "ended",
  "error",
  "loadedmetadata",
  "playing",
  "progress",
  "seeked",
  "seeking",
  "stalled",
  "timeupdate",
  "waiting",
] as const satisfies readonly (keyof HTMLMediaElementEventMap)[]

export const playable_time = (duration: number, value: number): number => {
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

export const playable_position = (
  media: HTMLMediaElement,
  value: number,
): number => playable_time(Number(media.dataset["duration"]), value)

const media_state = (media: HTMLMediaElement): MediaSnapshot => ({
  buffered: Array.from(
    { length: media.buffered.length },
    (_, index) =>
      [media.buffered.start(index), media.buffered.end(index)] as const,
  ),
  duration: Number(media.dataset["duration"]),
  error: media.error ?? undefined,
  metadata: media.readyState >= media.HAVE_METADATA,
  paused: media.paused,
  seeking: media.seeking,
  time: media.currentTime,
})

export const media_buffered = (media: HTMLMediaElement): MediaAction => ({
  current: media_state(media),
  type: "buffered",
})

export const media_events = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<readonly MediaAction[]> =>
  event_batches(signal, media, EVENTS, () => media_state(media))

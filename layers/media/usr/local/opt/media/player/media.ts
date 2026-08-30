import { event_batches } from "./util.ts"

export type MediaSnapshot = Readonly<{
  buffered: readonly (readonly [start: number, end: number])[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  seeking: boolean
  time: number
}>

export type MediaEvent =
  | "canplay"
  | "ended"
  | "error"
  | "loadedmetadata"
  | "progress"
  | "seeked"
  | "seeking"
  | "timeupdate"
  | "waiting"

export type MediaAction = Readonly<{
  current: MediaSnapshot
  type: MediaEvent
}>

const END_TOLERANCE = 0.5

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
] as const satisfies readonly MediaEvent[]

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

export const media_state = (media: HTMLMediaElement): MediaSnapshot => ({
  buffered: Array.from(
    { length: media.buffered.length },
    (_, index) =>
      [media.buffered.start(index), media.buffered.end(index)] as const,
  ),
  duration: Number(media.dataset["duration"]),
  error: media.error ?? undefined,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

export const media_events = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<readonly MediaAction[]> =>
  event_batches(signal, media, EVENTS, () => media_state(media))

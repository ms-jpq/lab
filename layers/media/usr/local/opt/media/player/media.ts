import { abortion, type EventOf } from "./util.ts"

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5

export type MediaSnapshot = Readonly<{
  ended: boolean
  error: MediaError | null
  metadata: boolean
  seeking: boolean
  time: number
}>

const EVENT_SNAPSHOTS = new WeakMap<Event, MediaSnapshot>()

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

export const playable_position = (
  media: HTMLMediaElement,
  value: number,
): number => {
  const duration = Number(media.dataset["duration"])
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

export const aligned = (left: number, right: number): boolean =>
  Math.abs(left - right) <= POSITION_TOLERANCE

const buffered_range = (
  media: HTMLMediaElement,
  position: number,
  inclusive: boolean,
): [number, number] | undefined => {
  const ranges = media.buffered
  for (let index = 0; index < ranges.length; index += 1) {
    const start = ranges.start(index)
    const end = ranges.end(index)
    if (
      start - position <= POSITION_TOLERANCE &&
      (inclusive ? position <= end : position < end)
    ) {
      return [start, end]
    }
  }
  return undefined
}

export const buffered_position = (
  media: HTMLMediaElement,
  position: number,
): number | undefined => {
  const range = buffered_range(media, position, false)
  return range ? Math.max(position, range.at(0) ?? -Infinity) : undefined
}

export const buffered_end = (
  media: HTMLMediaElement,
  position: number,
): number | undefined => buffered_range(media, position, true)?.at(1)

export const play_ahead = (
  media: HTMLMediaElement,
  frontier: number,
): number => {
  const end = buffered_end(media, media.currentTime)
  const frontier_end = buffered_end(media, frontier)
  return end !== undefined && aligned(end, frontier_end ?? NaN)
    ? end - media.currentTime
    : 0
}

export const media_snapshot = (media: HTMLMediaElement): MediaSnapshot => ({
  ended: media.ended,
  error: media.error,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

export const media_event_snapshot = (event: MediaEvent): MediaSnapshot =>
  EVENT_SNAPSHOTS.get(event) as MediaSnapshot

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaEvent[]> {
  using a = abortion(signal)

  let events = new Array<MediaEvent>()
  let fut = Promise.withResolvers()

  const aborted = (): void => {
    events = []
    fut.resolve(undefined)
  }
  const push = (event: MediaEvent) => {
    EVENT_SNAPSHOTS.set(event, media_snapshot(media))
    events.push(event)
    fut.resolve(undefined)
  }
  a.signal.addEventListener("abort", aborted, { once: true })
  for (const type of EVENTS) {
    media.addEventListener(type, push, { signal: a.signal })
  }

  while (!a.signal.aborted) {
    await fut.promise
    if (a.signal.aborted) {
      return
    }
    const batch = events
    events = []
    fut = Promise.withResolvers()
    yield batch
  }
  return
}

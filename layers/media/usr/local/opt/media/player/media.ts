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
export type MediaObservation = readonly [
  snapshot: MediaSnapshot,
  event: MediaEvent,
]
export type MediaTarget = {
  position: number
  restart: boolean
  started: boolean
}
export type MediaState = {
  readonly error: unknown
  readonly target: MediaTarget
  seek: () => void
  take_error: () => unknown
}

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

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaObservation[]> {
  using a = abortion(signal)

  if (a.signal.aborted) {
    return
  }

  let events = new Array<MediaObservation>()
  let fut = Promise.withResolvers()

  const aborted = () => {
    events = []
    fut.resolve(undefined)
  }
  const push = (event: MediaEvent) => {
    events.push([media_snapshot(media), event])
    fut.resolve(undefined)
  }
  a.signal.addEventListener("abort", aborted, { once: true })
  try {
    for (const type of EVENTS) {
      media.addEventListener(type, push)
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
  } finally {
    a.signal.removeEventListener("abort", aborted)
    for (const type of EVENTS) {
      media.removeEventListener(type, push)
    }
  }
  return
}

export const media_state = async function* (
  media: HTMLMediaElement,
  {
    persist,
    position,
    signal,
  }: {
    persist: (position: number) => void
    position: number
    signal: AbortSignal
  },
): AsyncGenerator<MediaState, void, void> {
  let current = media_snapshot(media)
  let previous = current
  let target = { position, restart: false, started: false }
  let handled = target
  let positioning: MediaTarget | undefined = target
  let failure: unknown | undefined

  const state: MediaState = {
    seek: (): void => {
      positioning = target
      target.started = false
      media.currentTime = target.position
    },
    take_error: (): unknown => {
      const error = failure
      failure = undefined
      return error
    },
    get error(): unknown {
      return failure
    },
    get target(): MediaTarget {
      return target
    },
  }

  if (signal.aborted) {
    return
  }
  yield state
  for await (const batch of media_events(media, signal)) {
    for (const [snapshot, event] of batch) {
      current = snapshot
      if (
        event.type === "error" &&
        current.error !== null &&
        current.error.code !== MediaError.MEDIA_ERR_ABORTED
      ) {
        failure ??= current.error
      }
      const owned =
        positioning !== undefined && aligned(current.time, positioning.position)
          ? positioning
          : undefined
      if ((event.type === "seeking" || event.type === "seeked") && owned) {
        owned.started = true
      }
      if (current.seeking && owned === undefined) {
        const native = playable_position(media, current.time)
        const playable = buffered_position(media, native)
        target = {
          position: playable ?? native,
          restart: playable === undefined,
          started: true,
        }
      }
    }

    const moved =
      current.time !== previous.time || current.seeking !== previous.seeking
    const changed = target !== handled
    if (changed) {
      positioning =
        target.restart || !aligned(current.time, target.position)
          ? target
          : undefined
      handled = target
      persist(target.position)
    }
    if (current.ended && !previous.ended) {
      persist(0)
    } else if (
      !changed &&
      positioning === undefined &&
      moved &&
      buffered_position(media, current.time) === current.time
    ) {
      persist(current.time)
    }
    if (positioning !== undefined) {
      const playable = buffered_position(media, positioning.position)
      positioning.position = playable ?? positioning.position
      if (!current.seeking) {
        const positioned = aligned(current.time, positioning.position)
        if (!positioned && (current.metadata || playable !== undefined)) {
          positioning.started = false
          media.currentTime = positioning.position
        } else if (positioned && positioning.started) {
          positioning = undefined
        }
      }
    }
    previous = current
    yield state
  }
  return
}

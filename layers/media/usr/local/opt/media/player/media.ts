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
}
export type MediaState = {
  readonly error: MediaError | undefined
  readonly target: MediaTarget
  seek: () => void
  take_error: () => MediaError | undefined
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
  if (signal.aborted) {
    return
  }

  let target = { position, restart: false }
  let pending_seek: { target: MediaTarget; acknowledged: boolean } | undefined =
    { target, acknowledged: false }
  let failure: MediaError | undefined

  const start_seek = (next: MediaTarget): void => {
    pending_seek = { target: next, acknowledged: false }
    media.currentTime = next.position
  }
  const state = {
    seek: (): void => start_seek(target),
    take_error: (): MediaError | undefined => {
      const error = failure
      failure = undefined
      return error
    },
    get error(): MediaError | undefined {
      return failure
    },
    get target(): MediaTarget {
      return target
    },
  } satisfies MediaState

  yield state
  for await (const batch of media_events(media, signal)) {
    const current = batch.at(-1)?.[0]
    if (current === undefined) {
      continue
    }
    let ended = false
    let moved = false
    let retargeted = false
    for (const [snapshot, event] of batch) {
      const { error, seeking, time } = snapshot
      const seek_event = event.type === "seeking" || event.type === "seeked"
      ended ||= event.type === "ended"
      moved ||= event.type === "timeupdate" || seek_event

      if (
        event.type === "error" &&
        error !== null &&
        error.code !== MediaError.MEDIA_ERR_ABORTED
      ) {
        failure ??= error
      }
      const owned_seek =
        pending_seek !== undefined &&
        aligned(time, pending_seek.target.position)
          ? pending_seek
          : undefined
      if (seek_event && owned_seek) {
        owned_seek.acknowledged = true
      }
      if (seeking && owned_seek === undefined) {
        const native = playable_position(media, time)
        const playable = buffered_position(media, native)
        target = {
          position: playable ?? native,
          restart: playable === undefined,
        }
        retargeted = true
      }
    }

    const { metadata, seeking, time } = current
    if (retargeted) {
      pending_seek =
        target.restart || !aligned(time, target.position)
          ? { target, acknowledged: false }
          : undefined
      persist(target.position)
    }
    if (ended) {
      persist(0)
    } else if (
      !retargeted &&
      pending_seek === undefined &&
      moved &&
      buffered_position(media, time) === time
    ) {
      persist(time)
    }
    if (pending_seek !== undefined) {
      const { target: seek_target } = pending_seek
      const playable = buffered_position(media, seek_target.position)
      seek_target.position = playable ?? seek_target.position
      if (!seeking) {
        const positioned = aligned(time, seek_target.position)
        if (!positioned && (metadata || playable !== undefined)) {
          start_seek(seek_target)
        } else if (positioned && pending_seek.acknowledged) {
          pending_seek = undefined
        }
      }
    }
    yield state
  }
  return
}

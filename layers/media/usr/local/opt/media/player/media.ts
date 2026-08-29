import { abortion, type EventOf } from "./util.ts"

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5

export type BufferedRange = readonly [start: number, end: number]
export type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  ended: boolean
  error: MediaError | undefined
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
export type MediaDerived = Readonly<{
  ended: boolean
  failure: MediaError | undefined
  moved: boolean
  seeks: readonly MediaObservation[]
}>
export type MediaState = Readonly<{
  current: MediaSnapshot
  derived: MediaDerived
}>
export type MediaStates = AsyncIteratorObject<MediaState> & {
  read: () => MediaSnapshot
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
  { buffered }: MediaSnapshot,
  position: number,
  inclusive: boolean,
): BufferedRange | undefined => {
  for (const [start, end] of buffered) {
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
  state: MediaSnapshot,
  position: number,
): number | undefined => {
  const range = buffered_range(state, position, false)
  return range ? Math.max(position, range.at(0) ?? -Infinity) : undefined
}

export const buffered_end = (
  state: MediaSnapshot,
  position: number,
): number | undefined => buffered_range(state, position, true)?.at(1)

export const play_ahead = (state: MediaSnapshot, frontier: number): number => {
  const end = buffered_end(state, state.time)
  const frontier_end = buffered_end(state, frontier)
  return end !== undefined && aligned(end, frontier_end ?? NaN)
    ? end - state.time
    : 0
}

const media_snapshot = (media: HTMLMediaElement): MediaSnapshot => ({
  buffered: Array.from(
    { length: media.buffered.length },
    (_, index) =>
      [media.buffered.start(index), media.buffered.end(index)] as const,
  ),
  ended: media.ended,
  error: media.error ?? undefined,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

const derive = (observations: readonly MediaObservation[]): MediaDerived => ({
  ended: observations.some(([, event]) => event.type === "ended"),
  failure: observations.find(
    ([{ error }, event]) =>
      event.type === "error" &&
      error !== undefined &&
      error.code !== MediaError.MEDIA_ERR_ABORTED,
  )?.[0].error,
  moved: observations.some(([, event]) =>
    ["seeked", "seeking", "timeupdate"].includes(event.type),
  ),
  seeks: observations.filter(([, event]) =>
    ["seeked", "seeking"].includes(event.type),
  ),
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

export const media_states = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): MediaStates => {
  const read = (): MediaSnapshot => media_snapshot(media)
  const states = (async function* (): AsyncIteratorObject<MediaState> {
    using a = abortion(signal)

    if (a.signal.aborted) {
      return
    }

    const events = media_events(media, a.signal)
    let pending = events.next()
    try {
      yield { current: read(), derived: derive([]) }
      for (;;) {
        const next = await pending
        if (next.done) {
          return
        }
        pending = events.next()
        const current = next.value.at(-1)?.[0]
        if (current !== undefined) {
          yield { current, derived: derive(next.value) }
        }
      }
    } finally {
      a[Symbol.dispose]()
      await events.return?.()
    }
  })()
  return Object.assign(states, { read })
}

import {
  abortion,
  event_batches,
  type EventObservation,
} from "./util.ts"

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5

export type BufferedRange = readonly [start: number, end: number]
export type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  duration: number
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

type MediaObservation = EventObservation<
  HTMLMediaElement,
  (typeof EVENTS)[number],
  MediaSnapshot
>
export type MediaTarget = { position: number; restart: boolean }
export type MediaSeek = Readonly<{
  candidate: MediaTarget
  position: number
  seeking: boolean
}>
type MediaResume =
  | Readonly<{ reason: "ended"; position: 0 }>
  | Readonly<{ reason: "progress"; position: number }>
export type MediaDerived = Readonly<{
  failure: MediaError | undefined
  resume: MediaResume | undefined
  seeks: readonly MediaSeek[]
}>
export type MediaState = Readonly<{
  current: MediaSnapshot
  derived: MediaDerived
}>

const playable = (duration: number, value: number): number => {
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

export const playable_position = (
  media: HTMLMediaElement,
  value: number,
): number => playable(Number(media.dataset["duration"]), value)

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
  duration: Number(media.dataset["duration"]),
  ended: media.ended,
  error: media.error ?? undefined,
  metadata: media.readyState >= media.HAVE_METADATA,
  seeking: media.seeking,
  time: media.currentTime,
})

const derive = (observations: readonly MediaObservation[]): MediaDerived => {
  const current = observations.at(-1)?.[0]
  const ended = observations.some(([, event]) => event.type === "ended")
  const moved = observations.some(([, event]) =>
    ["seeked", "seeking", "timeupdate"].includes(event.type),
  )

  const resume = ended
    ? ({ reason: "ended", position: 0 } as const)
    : moved &&
        current !== undefined &&
        buffered_position(current, current.time) === current.time
      ? ({ reason: "progress", position: current.time } as const)
      : undefined

  const failure = observations.find(
    ([{ error }, event]) =>
      event.type === "error" &&
      error !== undefined &&
      error.code !== MediaError.MEDIA_ERR_ABORTED,
  )?.[0].error

  const seeks = observations.flatMap(([snapshot, event]) => {
    if (event.type !== "seeked" && event.type !== "seeking") return []
    const { duration, seeking, time } = snapshot
    const native = playable(duration, time)
    const position = buffered_position(snapshot, native)
    return [
      {
        candidate: {
          position: position ?? native,
          restart: position === undefined,
        },
        position: time,
        seeking,
      },
    ]
  })

  return { failure, resume, seeks }
}

export const media_states = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaState> =>
  (async function* (): AsyncIteratorObject<MediaState> {
    using a = abortion(signal)

    if (a.signal.aborted) {
      return
    }

    const events = event_batches(a.signal, media, EVENTS, () =>
      media_snapshot(media),
    )
    let pending = events.next()
    yield { current: media_snapshot(media), derived: derive([]) }
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
  })()

import {
  abortion,
  event_batches,
  merge,
  type EventObservation,
  type EventOf,
} from "./util.ts"

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
export type MediaObservation = EventObservation<
  HTMLMediaElement,
  (typeof EVENTS)[number],
  MediaSnapshot
>
export type MediaDerived = Readonly<{
  ended: boolean
  failure: MediaError | undefined
  moved: boolean
  seeks: readonly MediaObservation[]
}>
type ObservedMediaState = Readonly<{
  current: MediaSnapshot
  derived: MediaDerived
}>
type InputMediaState<T> = ObservedMediaState & Readonly<{ input: T }>
export type MediaState<T = never> = ObservedMediaState | InputMediaState<T>

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

export const media_events = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaObservation[]> =>
  event_batches(signal, media, EVENTS, () => media_snapshot(media))

const from = <T>(
  source: AsyncIterator<T>,
  selection: readonly [AsyncIterator<unknown>, unknown],
): selection is readonly [AsyncIterator<T>, T] => selection[0] === source

export const media_states = <T = never>(
  media: HTMLMediaElement,
  signal: AbortSignal,
  inputs?: AsyncIterator<T>,
): AsyncIteratorObject<MediaState<T>> =>
  (async function* (): AsyncIteratorObject<MediaState<T>> {
    using a = abortion(signal)

    if (a.signal.aborted) {
      return
    }

    const events = media_events(media, a.signal)
    if (inputs === undefined) {
      let pending = events.next()
      yield { current: media_snapshot(media), derived: derive([]) }
      for (;;) {
        const next = await pending
        if (next.done) return
        pending = events.next()
        const current = next.value.at(-1)?.[0]
        if (current !== undefined) {
          yield { current, derived: derive(next.value) }
        }
      }
    }

    const updates = merge(events, inputs)
    let pending = updates.next()
    yield { current: media_snapshot(media), derived: derive([]) }
    try {
      for (;;) {
        const next = await pending
        if (next.done) return
        pending = updates.next()
        if (from(events, next.value)) {
          const current = next.value[1].at(-1)?.[0]
          if (current !== undefined) {
            yield { current, derived: derive(next.value[1]) }
          }
        } else {
          yield {
            current: media_snapshot(media),
            derived: derive([]),
            input: next.value[1],
          }
        }
      }
    } finally {
      a[Symbol.dispose]()
      await updates.return?.()
    }
  })()

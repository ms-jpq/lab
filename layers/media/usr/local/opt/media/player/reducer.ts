import { abortion, event_batches, type EventObservation } from "./util.ts"

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5

type BufferedRange = readonly [start: number, end: number]
type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  seeking: boolean
  time: number
}>

const playable_time = (duration: number, value: number): number => {
  const position = Number.isFinite(value) ? Math.max(0, value) : 0
  return duration > 0 && position >= duration
    ? Math.max(0, duration - END_TOLERANCE)
    : position
}

export const playable_position = (
  media: HTMLMediaElement,
  value: number,
): number => playable_time(Number(media.dataset["duration"]), value)

const aligned = (left: number, right: number): boolean =>
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

const buffered_position = (
  state: MediaSnapshot,
  position: number,
): number | undefined => {
  const range = buffered_range(state, position, false)
  return range ? Math.max(position, range.at(0) ?? -Infinity) : undefined
}

const buffered_end = (
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

export type MediaTarget = Readonly<{ position: number; restart: boolean }>
export type MediaSeek = Readonly<{
  candidate: MediaTarget
  position: number
}>
type MediaResume =
  | Readonly<{ reason: "ended"; position: 0 }>
  | Readonly<{ reason: "progress"; position: number }>
export type MediaDerived = Readonly<{
  failure: MediaError | undefined
  resume: MediaResume | undefined
  seek: MediaSeek | undefined
}>
export type MediaState = Readonly<{
  kind: "media"
  current: MediaSnapshot
  derived: MediaDerived
  media: HTMLMediaElement
}>

type PendingSeek = Readonly<{
  acknowledged: boolean
  target: MediaTarget
}>
export type PlaybackStream = Readonly<{
  accepted: MediaTarget
  frontier: number
  restart: number | undefined
  start: number
}>
export type PlaybackState = Readonly<{
  current: MediaSnapshot
  failure: MediaError | undefined
  media: HTMLMediaElement
  pending_seek: PendingSeek | undefined
  stream: PlaybackStream
  target: MediaTarget
}>
export type PlaybackAction =
  | Readonly<{ kind: "consume_failure" }>
  | Readonly<{ advance: boolean; kind: "frontier" }>
  | MediaState
  | Readonly<{ kind: "seek"; target: MediaTarget }>
  | Readonly<{ kind: "stream_started" }>
export type PlaybackEffects = Readonly<{
  persist: number | undefined
  seek: number | undefined
}>
export type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const start_stream = (target: MediaTarget): PlaybackStream => ({
  accepted: target,
  frontier: stream_position(target.position),
  restart: undefined,
  start: target.position,
})

const reconcile = (
  stream: PlaybackStream,
  target: MediaTarget,
): PlaybackStream => {
  if (target === stream.accepted) {
    return stream
  }
  if (target.restart && !aligned(target.position, stream.frontier)) {
    return { ...stream, restart: target.position }
  }
  return { ...stream, accepted: target, restart: undefined }
}

export const should_interrupt = ({ failure, stream }: PlaybackState): boolean =>
  failure !== undefined || stream.restart !== undefined

export const initial_playback = (
  position: number,
  { current, derived, media }: MediaState,
): PlaybackState => {
  const target = { position, restart: false }
  return {
    current,
    failure: derived.failure,
    media,
    pending_seek: { target, acknowledged: false },
    stream: start_stream(target),
    target,
  }
}
const capture = (media: HTMLMediaElement): MediaSnapshot => ({
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

const resume = (
  current: MediaSnapshot,
  observations: readonly MediaObservation[],
): MediaResume | undefined =>
  observations.some(([, event]) => event.type === "ended")
    ? ({ reason: "ended", position: 0 } as const)
    : observations.some(([, event]) =>
          ["seeked", "seeking", "timeupdate"].includes(event.type),
        ) && buffered_position(current, current.time) === current.time
      ? ({ reason: "progress", position: current.time } as const)
      : undefined

const failure = (
  observations: readonly MediaObservation[],
): MediaError | undefined =>
  observations.find(
    ([{ error }, event]) =>
      event.type === "error" &&
      error !== undefined &&
      error.code !== MediaError.MEDIA_ERR_ABORTED,
  )?.[0].error

const seek = (
  observations: readonly MediaObservation[],
): MediaSeek | undefined => {
  const observation = observations.findLast(
    ([, event]) => event.type === "seeked" || event.type === "seeking",
  )
  if (observation === undefined) {
    return undefined
  }

  const [snapshot] = observation
  const { duration, time } = snapshot
  const native = playable_time(duration, time)
  const position = buffered_position(snapshot, native)
  return {
    candidate: {
      position: position ?? native,
      restart: position === undefined,
    },
    position: time,
  }
}

const derive = (
  current: MediaSnapshot,
  observations: readonly MediaObservation[],
): MediaDerived => ({
  failure: failure(observations),
  resume: resume(current, observations),
  seek: seek(observations),
})

export const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  switch (action.kind) {
    case "consume_failure": {
      return [
        { ...state, failure: undefined },
        { persist: undefined, seek: undefined },
      ]
    }
    case "frontier": {
      const frontier = stream_position(
        buffered_end(state.current, state.stream.frontier) ??
          state.stream.frontier,
      )
      const stream = reconcile(
        {
          ...state.stream,
          frontier,
          start: action.advance ? frontier : state.stream.start,
        },
        state.target,
      )
      return [
        { ...state, stream },
        { persist: undefined, seek: undefined },
      ]
    }
    case "seek": {
      return [
        {
          ...state,
          pending_seek: { target: action.target, acknowledged: false },
        },
        { persist: undefined, seek: action.target.position },
      ]
    }
    case "stream_started": {
      return [
        { ...state, stream: start_stream(state.target) },
        { persist: undefined, seek: undefined },
      ]
    }
    case "media": {
      const {
        current,
        derived: { failure, resume, seek: observed_seek },
      } = action
      const pending = state.pending_seek

      const owned_seek =
        pending !== undefined &&
        observed_seek !== undefined &&
        aligned(observed_seek.position, pending.target.position)
      const external_seek = owned_seek ? undefined : observed_seek
      const target = external_seek?.candidate ?? state.target

      let pending_seek = owned_seek
        ? { ...pending, acknowledged: true }
        : pending
      let seek: number | undefined

      const { metadata, seeking, time } = current
      if (external_seek !== undefined) {
        pending_seek =
          target.restart || !aligned(time, target.position)
            ? { target, acknowledged: false }
            : undefined
      }

      const persist =
        resume !== undefined &&
        (resume.reason === "ended" ||
          (external_seek === undefined && pending_seek === undefined))
          ? resume.position
          : external_seek?.candidate.position

      if (pending_seek !== undefined && !seeking) {
        const pending_target = pending_seek.target
        const playable = buffered_position(current, pending_target.position)
        const seek_target = {
          ...pending_target,
          position: playable ?? pending_target.position,
        }
        const positioned = aligned(time, seek_target.position)
        if (!positioned && (metadata || playable !== undefined)) {
          pending_seek = { target: seek_target, acknowledged: false }
          seek = seek_target.position
        } else if (positioned && pending_seek.acknowledged) {
          pending_seek = undefined
        }
      }

      return [
        {
          current,
          failure: state.failure ?? failure,
          media: state.media,
          pending_seek,
          stream: reconcile(state.stream, target),
          target,
        },
        { persist, seek },
      ]
    }
  }
}

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaState> {
  using a = abortion(signal)
  if (a.signal.aborted) {
    return
  }

  const events = event_batches(a.signal, media, EVENTS, () => capture(media))
  let pending = events.next()
  const initial = capture(media)
  yield {
    kind: "media",
    current: initial,
    derived: derive(initial, []),
    media,
  }
  for (;;) {
    const next = await pending
    if (next.done) {
      return
    }
    pending = events.next()
    const current = next.value.at(-1)?.[0] ?? capture(media)
    yield {
      kind: "media",
      current,
      derived: derive(current, next.value),
      media,
    }
  }
}

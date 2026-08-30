import { events, merge } from "./util.ts"

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

export type MediaTarget = Readonly<{ position: number; restart: boolean }>
export type MediaSeek = Readonly<{
  candidate: MediaTarget
  position: number
}>
export type MediaAction = Readonly<{
  event: Event
  kind: "media"
}>

type PendingSeek = Readonly<{
  acknowledged: boolean
  target: MediaTarget
}>
export type PlaybackStream = Readonly<{
  accepted: MediaTarget
  frontier: number
  restart: boolean
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
  | MediaAction
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
  restart: false,
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
    return { ...stream, restart: true }
  }
  return { ...stream, accepted: target, restart: false }
}

export const should_interrupt = ({ failure, stream }: PlaybackState): boolean =>
  failure !== undefined || stream.restart

export const initial_playback = (
  media: HTMLMediaElement,
  position: number,
): PlaybackState => {
  const target = { position, restart: false }
  return {
    current: capture(media),
    failure: undefined,
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

const failure = (
  current: MediaSnapshot,
  event: Event,
): MediaError | undefined =>
  event.type === "error" &&
  current.error !== undefined &&
  current.error.code !== MediaError.MEDIA_ERR_ABORTED
    ? current.error
    : undefined

const latest_seek = (
  current: MediaSnapshot,
  event: Event,
): MediaSeek | undefined => {
  if (event.type !== "seeked" && event.type !== "seeking") {
    return undefined
  }

  const { duration, time } = current
  const native = playable_time(duration, time)
  const position = buffered_position(current, native)
  return {
    candidate: {
      position: position ?? native,
      restart: position === undefined,
    },
    position: time,
  }
}

type ObservedSeek = Readonly<{
  external: MediaSeek | undefined
  pending: PendingSeek | undefined
  target: MediaTarget
}>

const observe_seek = (
  state: PlaybackState,
  current: MediaSnapshot,
  observed: MediaSeek | undefined,
): ObservedSeek => {
  const pending = state.pending_seek
  const owned =
    pending !== undefined &&
    observed !== undefined &&
    aligned(observed.position, pending.target.position)
  const external = owned ? undefined : observed
  const target = external?.candidate ?? state.target

  if (external !== undefined) {
    return {
      external,
      pending:
        target.restart || !aligned(current.time, target.position)
          ? { target, acknowledged: false }
          : undefined,
      target,
    }
  }
  return {
    external,
    pending: owned ? { ...pending, acknowledged: true } : pending,
    target,
  }
}

const advance_seek = (
  current: MediaSnapshot,
  pending: PendingSeek | undefined,
): readonly [PendingSeek | undefined, number | undefined] => {
  if (pending === undefined || current.seeking) {
    return [pending, undefined]
  }

  const playable = buffered_position(current, pending.target.position)
  const target = {
    ...pending.target,
    position: playable ?? pending.target.position,
  }
  const positioned = aligned(current.time, target.position)
  if (!positioned && (current.metadata || playable !== undefined)) {
    return [{ target, acknowledged: false }, target.position]
  }
  if (positioned && pending.acknowledged) {
    return [undefined, undefined]
  }
  return [pending, undefined]
}

const persisted_position = (
  current: MediaSnapshot,
  event: Event,
  external: MediaSeek | undefined,
  pending: PendingSeek | undefined,
): number | undefined => {
  if (event.type === "ended") {
    return 0
  }
  if (external !== undefined) {
    return external.candidate.position
  }
  const progressed = ["seeked", "seeking", "timeupdate"].includes(event.type)
  if (
    progressed &&
    pending === undefined &&
    buffered_position(current, current.time) === current.time
  ) {
    return current.time
  }
  return undefined
}

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
      const { event } = action
      const current = capture(state.media)
      const observed_failure = failure(current, event)
      const observed_seek = latest_seek(current, event)
      const observed = observe_seek(state, current, observed_seek)
      const persist = persisted_position(
        current,
        event,
        observed.external,
        observed.pending,
      )
      const [pending_seek, seek] = advance_seek(current, observed.pending)

      return [
        {
          ...state,
          current,
          failure: state.failure ?? observed_failure,
          pending_seek,
          stream: reconcile(state.stream, observed.target),
          target: observed.target,
        },
        { persist, seek },
      ]
    }
  }
}

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaAction> {
  const streams: AsyncIteratorObject<Event>[] = EVENTS.map((event) =>
    events(signal, media, event),
  )
  for await (const [, event] of merge(...streams)) {
    yield { event, kind: "media" }
  }
  return
}

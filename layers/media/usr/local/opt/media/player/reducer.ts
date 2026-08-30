import { abortion, events, merge } from "./util.ts"

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5
export const BUFFER_BEHIND = 30
const BUFFER_LOW = 45
const BUFFER_HIGH = 60

type BufferedRange = readonly [start: number, end: number]

type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  seeking: boolean
  time: number
}>

export type PlaybackStream = Readonly<{
  accepted: MediaTarget
  frontier: number
  start: number
}>

export type PlaybackState = Readonly<{
  current: MediaSnapshot
  failure: MediaError | undefined
  media: HTMLMediaElement
  pending_seek: MediaTarget | undefined
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

export type MediaTarget = Readonly<{ position: number; restart: boolean }>

export type MediaAction = Readonly<{
  event: Event
  kind: "media"
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

const play_ahead = (state: MediaSnapshot, frontier: number): number => {
  const end = buffered_end(state, state.time)
  const frontier_end = buffered_end(state, frontier)
  return end !== undefined && aligned(end, frontier_end ?? NaN)
    ? end - state.time
    : 0
}

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const start_stream = (target: MediaTarget): PlaybackStream => ({
  accepted: target,
  frontier: stream_position(target.position),
  start: target.position,
})

const restart = (stream: PlaybackStream, target: MediaTarget): boolean =>
  target !== stream.accepted &&
  target.restart &&
  !aligned(target.position, stream.frontier)

const reconcile = (
  stream: PlaybackStream,
  target: MediaTarget,
): PlaybackStream => {
  if (target === stream.accepted || restart(stream, target)) {
    return stream
  }
  return { ...stream, accepted: target }
}

export const needs_restart = ({ stream, target }: PlaybackState): boolean =>
  restart(stream, target)

export const should_interrupt = (state: PlaybackState): boolean =>
  state.failure !== undefined || needs_restart(state)

export const needs_data = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.start) < BUFFER_LOW

export const request_full = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.frontier) >= BUFFER_HIGH

export const source_invalidated = (
  { failure, target }: PlaybackState,
  attempt: MediaTarget,
): boolean => failure !== undefined || (target !== attempt && target.restart)

export const initial_playback = (
  media: HTMLMediaElement,
  position: number,
): PlaybackState => {
  const target = { position, restart: false }
  return {
    current: capture(media),
    failure: undefined,
    media,
    pending_seek: target,
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

const reduce_media = (
  state: PlaybackState,
  event: Event,
): PlaybackTransition => {
  const current = capture(state.media)
  let failure = state.failure
  let target = state.target
  let pending = state.pending_seek
  let persist: number | undefined
  let seek: number | undefined

  if (
    event.type === "error" &&
    current.error !== undefined &&
    current.error.code !== MediaError.MEDIA_ERR_ABORTED
  ) {
    failure ??= current.error
  }

  if (event.type === "seeked" || event.type === "seeking") {
    const native = playable_time(current.duration, current.time)
    const position = buffered_position(current, native)
    const candidate = {
      position: position ?? native,
      restart: position === undefined,
    }
    if (pending === undefined || !aligned(current.time, pending.position)) {
      target = candidate
      pending =
        target.restart || !aligned(current.time, target.position)
          ? target
          : undefined
      persist = target.position
    }
  }

  if (event.type === "ended") {
    persist = 0
  } else if (
    persist === undefined &&
    ["seeked", "seeking", "timeupdate"].includes(event.type) &&
    pending === undefined &&
    buffered_position(current, current.time) === current.time
  ) {
    persist = current.time
  }

  if (pending !== undefined && !current.seeking) {
    const playable = buffered_position(current, pending.position)
    const candidate = {
      ...pending,
      position: playable ?? pending.position,
    }
    const positioned = aligned(current.time, candidate.position)
    if (!positioned && (current.metadata || playable !== undefined)) {
      pending = candidate
      seek = candidate.position
    } else if (positioned) {
      pending = undefined
    }
  }

  return [
    {
      ...state,
      current,
      failure,
      pending_seek: pending,
      stream: reconcile(state.stream, target),
      target,
    },
    { persist, seek },
  ]
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
          pending_seek: action.target,
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
      return reduce_media(state, action.event)
    }
  }
}

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaAction> {
  using a = abortion(signal)
  const streams: AsyncIteratorObject<Event>[] = EVENTS.map((event) =>
    events(a.signal, media, event),
  )
  for await (const [, event] of merge(...streams)) {
    yield { event, kind: "media" }
  }
  return
}

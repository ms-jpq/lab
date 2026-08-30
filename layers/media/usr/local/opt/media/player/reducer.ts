import { abortion, events, merge, type EventOf } from "./util.ts"

type BufferedRange = readonly [start: number, end: number]

type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  seeking: boolean
  time: number
}>

export type MediaTarget = Readonly<{ position: number; restart: boolean }>

export type PlaybackStream = Readonly<{
  frontier: number
  start: number
}>

export type PlaybackState = Readonly<{
  current: MediaSnapshot
  pending_seek: MediaTarget | undefined
  stream: PlaybackStream
  target: MediaTarget
}>

type MediaEvent =
  | "canplay"
  | "ended"
  | "error"
  | "loadedmetadata"
  | "progress"
  | "seeked"
  | "seeking"
  | "timeupdate"
  | "waiting"

export type MediaAction<T extends MediaEvent = MediaEvent> = Readonly<{
  current: MediaSnapshot
  event: EventOf<HTMLMediaElement, T>
  type: T
}>

export type PlaybackAction =
  | MediaAction
  | Readonly<{ type: "request_failed" }>
  | Readonly<{ type: "source_opened" }>

export type PlaybackInterruption =
  | Readonly<{ error: MediaError; type: "failure" }>
  | Readonly<{ type: "restart" }>

export type PlaybackEffects = Readonly<{
  interrupt?: PlaybackInterruption | undefined
  persist?: number | undefined
  seek?: number | undefined
}>

export type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5
export const BUFFER_BEHIND = 30
const BUFFER_LOW = 45
const BUFFER_HIGH = 60

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
  frontier: stream_position(target.position),
  start: target.position,
})

export const needs_data = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.start) < BUFFER_LOW

export const request_full = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.frontier) >= BUFFER_HIGH

export const source_invalidated = (
  { target }: PlaybackState,
  attempt: MediaTarget,
): boolean => target !== attempt && target.restart

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

export const initial_playback = (
  media: HTMLMediaElement,
  position: number,
): PlaybackState => {
  const target = { position, restart: false }
  return {
    current: capture(media),
    pending_seek: target,
    stream: start_stream(target),
    target,
  }
}

const observe = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackTransition => {
  let pending = state.pending_seek
  let seek: number | undefined

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

  const frontier = stream_position(
    buffered_end(current, state.stream.frontier) ?? state.stream.frontier,
  )
  const stream = {
    frontier,
    start:
      play_ahead(current, frontier) >= BUFFER_HIGH
        ? frontier
        : state.stream.start,
  }

  return [
    {
      ...state,
      current,
      pending_seek: pending,
      stream,
    },
    { seek },
  ]
}

export const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  switch (action.type) {
    case "request_failed": {
      const frontier = stream_position(
        buffered_end(state.current, state.stream.frontier) ??
          state.stream.frontier,
      )
      const stream = { ...state.stream, frontier, start: frontier }
      return [{ ...state, stream }, {}]
    }
    case "source_opened": {
      return [
        {
          ...state,
          pending_seek: state.target,
          stream: start_stream(state.target),
        },
        { seek: state.target.position },
      ]
    }
    case "canplay":
    case "loadedmetadata":
    case "progress":
    case "waiting": {
      return observe(state, action.current)
    }
    case "ended": {
      return [{ ...state, current: action.current }, { persist: 0 }]
    }
    case "timeupdate": {
      const persist =
        state.pending_seek === undefined
          ? buffered_position(action.current, action.current.time)
          : undefined

      const [next, effects] = observe(state, action.current)
      return [next, { ...effects, persist }]
    }
    case "error": {
      const { error } = action.current
      return [
        { ...state, current: action.current },
        {
          interrupt:
            error !== undefined && error.code !== MediaError.MEDIA_ERR_ABORTED
              ? { error, type: "failure" }
              : undefined,
        },
      ]
    }
    case "seeked":
    case "seeking": {
      const { current } = action
      const native = playable_time(current.duration, current.time)
      const buffered = buffered_position(current, native)
      const target = {
        position: buffered ?? native,
        restart: buffered === undefined,
      }
      const external =
        state.pending_seek === undefined ||
        !aligned(current.time, state.pending_seek.position)
      if (!external) {
        return observe(state, current)
      }

      const restart =
        target.restart && !aligned(target.position, state.stream.frontier)
      const pending_seek =
        target.restart || !aligned(current.time, target.position)
          ? target
          : undefined
      const [next, effects] = observe(
        {
          ...state,
          pending_seek,
          stream: restart ? start_stream(target) : state.stream,
          target,
        },
        current,
      )
      return [
        next,
        {
          ...effects,
          interrupt: restart ? { type: "restart" } : undefined,
          persist: target.position,
        },
      ]
    }
  }
}

export const media_events = async function* (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaAction> {
  using a = abortion(signal)

  const streams = EVENTS.map((type) =>
    (async function* () {
      for await (const event of events(a.signal, media, type)) {
        yield { current: capture(media), event, type }
      }
    })(),
  )

  for await (const [, action] of merge(...streams)) {
    yield action as MediaAction
  }
  return
}

import { abortion, events, merge, type EventOf } from "./util.ts"

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
  frontier: number
  start: number
}>

export type PlaybackState = Readonly<{
  current: MediaSnapshot
  pending_seek: MediaTarget | undefined
  stream: PlaybackStream
  target: MediaTarget
}>

export type PlaybackAction =
  | MediaAction
  | Readonly<{ type: "request_failed" }>
  | Readonly<{ type: "source_opened" }>

export type PlaybackInterruption =
  | Readonly<{ error: MediaError; type: "failure" }>
  | Readonly<{ type: "restart" }>

export type PlaybackEffects = Readonly<{
  interrupt?: PlaybackInterruption
  persist?: number
  seek?: number
}>

export type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

export type MediaTarget = Readonly<{ position: number; restart: boolean }>

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

type MediaEvent = (typeof EVENTS)[number]

export type MediaAction<T extends MediaEvent = MediaEvent> = Readonly<{
  current: MediaSnapshot
  event: EventOf<HTMLMediaElement, T>
  type: T
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

const needs_restart = (stream: PlaybackStream, target: MediaTarget): boolean =>
  target.restart && !aligned(target.position, stream.frontier)

export const needs_data = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.start) < BUFFER_LOW

export const request_full = ({ current, stream }: PlaybackState): boolean =>
  play_ahead(current, stream.frontier) >= BUFFER_HIGH

export const source_invalidated = (
  { target }: PlaybackState,
  attempt: MediaTarget,
): boolean => target !== attempt && target.restart

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
  action: MediaAction,
): PlaybackTransition => {
  const { current } = action
  let target = state.target
  let pending = state.pending_seek
  let persist: number | undefined
  let restart = false
  let seek: number | undefined

  if (action.type === "seeked" || action.type === "seeking") {
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
      restart = needs_restart(state.stream, target)
    }
  }

  if (action.type === "ended") {
    persist = 0
  } else if (
    persist === undefined &&
    (action.type === "seeked" ||
      action.type === "seeking" ||
      action.type === "timeupdate") &&
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

  const frontier = stream_position(
    buffered_end(current, state.stream.frontier) ?? state.stream.frontier,
  )
  const stream = restart
    ? start_stream(target)
    : {
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
      target,
    },
    {
      interrupt:
        action.type === "error" &&
        current.error !== undefined &&
        current.error.code !== MediaError.MEDIA_ERR_ABORTED
          ? { error: current.error, type: "failure" }
          : restart
            ? { type: "restart" }
            : undefined,
      persist,
      seek,
    },
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
    case "ended":
    case "error":
    case "loadedmetadata":
    case "progress":
    case "seeked":
    case "seeking":
    case "timeupdate":
    case "waiting": {
      return reduce_media(state, action)
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

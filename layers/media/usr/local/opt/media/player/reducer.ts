import { playable_time, POSITION_TOLERANCE } from "./media.ts"
import type { MediaAction, MediaSnapshot } from "./media.ts"
import { never } from "./util.ts"

type PlaybackRequest = Readonly<{ frontier: number; position: number }>

type BufferEffect =
  | Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: "append" }>
  | Readonly<{ type: "end" }>

type PlaybackControl =
  | Readonly<{ type: "pause" }>
  | Readonly<{ request: PlaybackRequest; type: "request" }>
  | Readonly<{ type: "rebuild" }>
  | Readonly<{ type: "retry" }>

type Acquisition = "active" | "backpressured" | "idle"

type PlaybackState = Readonly<{
  acquisition: Acquisition
  buffer_low: number
  pending_seek: number | undefined
  request: PlaybackRequest
  resume: boolean
  target: number
}>

type PlaybackAction =
  | MediaAction
  | Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: "bytes_received" }>
  | Readonly<{
      current: MediaSnapshot
      type: "buffer_full"
    }>
  | Readonly<{ error: unknown; type: "request_failed" }>
  | Readonly<{ type: "request_finished" }>
  | Readonly<{ current: MediaSnapshot; type: "request_retry" }>
  | Readonly<{
      paused: boolean
      position: number | undefined
      type: "source_closed"
    }>
  | Readonly<{ type: "source_opened" }>

type PlaybackEffects = Readonly<{
  buffer?: BufferEffect
  control?: PlaybackControl
  error?: unknown
  persist?: number
  play?: boolean
  seek?: number
}>

type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

export const BUFFER_LOW = 45
export const BUFFER_HIGH = 60

const aligned = (left: number, right: number): boolean =>
  Math.abs(left - right) <= POSITION_TOLERANCE

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const buffered_range = (
  { buffered }: MediaSnapshot,
  position: number,
  inclusive: boolean,
): readonly [start: number, end: number] | undefined =>
  buffered.find(
    ([start, end]) =>
      start - position <= POSITION_TOLERANCE &&
      (inclusive
        ? position <= Math.max(end, stream_position(end))
        : position < end),
  )

const buffered_position = (
  state: MediaSnapshot,
  position: number,
): number | undefined => {
  const start = buffered_range(state, position, false)?.[0]
  return start === undefined ? undefined : Math.max(position, start)
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

const request_at = (position: number): PlaybackRequest => ({
  frontier: stream_position(position),
  position,
})

const at_end = ({ duration }: MediaSnapshot, position: number): boolean =>
  duration > 0 && position >= duration - POSITION_TOLERANCE

const complete = (state: PlaybackState, current: MediaSnapshot): boolean =>
  at_end(
    current,
    buffered_end(current, state.pending_seek ?? current.time) ?? current.time,
  )

const request_if_needed = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackTransition => {
  if (
    state.acquisition === "active" ||
    complete(state, current) ||
    play_ahead(current, state.request.position) >= state.buffer_low
  ) {
    return [state, {}]
  }
  const request = request_at(state.request.frontier)
  return [
    { ...state, acquisition: "active", request },
    { control: { request, type: "request" } },
  ]
}

const acknowledge = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackState => {
  const frontier = stream_position(
    buffered_end(current, state.request.frontier) ?? state.request.frontier,
  )
  const pause =
    state.acquisition === "active" &&
    !aligned(frontier, state.request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH
  return {
    ...state,
    acquisition: pause ? "backpressured" : state.acquisition,
    request: {
      frontier,
      position: pause ? frontier : state.request.position,
    },
  }
}

const project = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackTransition => {
  const candidate =
    state.pending_seek === undefined || current.seeking
      ? undefined
      : (buffered_position(current, state.pending_seek) ??
        (current.metadata ? state.pending_seek : undefined))
  const seek =
    candidate !== undefined && !aligned(current.time, candidate)
      ? candidate
      : undefined
  const pending_seek = candidate === undefined ? state.pending_seek : seek
  const play =
    state.resume &&
    current.metadata &&
    !current.seeking &&
    pending_seek === undefined

  const frontier = stream_position(
    buffered_end(current, state.request.frontier) ?? state.request.frontier,
  )
  const advance =
    !aligned(frontier, state.request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH
  const pause =
    state.acquisition === "backpressured" ||
    (state.acquisition === "active" && advance)
  const [next, effects] = request_if_needed(
    {
      ...state,
      acquisition: pause ? "idle" : state.acquisition,
      pending_seek,
      request: {
        frontier,
        position: advance ? frontier : state.request.position,
      },
      resume: state.resume && !play,
      target: pending_seek ?? playable_time(current.duration, current.time),
    },
    current,
  )
  const controlled = {
    ...effects,
    ...(pause && effects.control === undefined
      ? { control: { type: "pause" } as const }
      : {}),
    ...(seek === undefined ? {} : { seek }),
    ...(play ? { play: true } : {}),
  }
  return [next, controlled]
}

const pause = (
  state: PlaybackState,
  error: unknown = undefined,
): PlaybackTransition => [
  { ...state, acquisition: "idle" },
  error === undefined
    ? { control: { type: "pause" } }
    : { control: { type: "pause" }, error },
]

const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  switch (action.type) {
    case "buffer_full": {
      const ahead = play_ahead(action.current, state.request.frontier)
      return [
        {
          ...state,
          acquisition: "idle",
          buffer_low: Math.min(state.buffer_low, ahead / 2),
          request: request_at(state.request.frontier),
        },
        ahead > 0 ? {} : { control: { type: "retry" } },
      ]
    }
    case "bytes_received":
      return state.acquisition === "backpressured"
        ? pause(state)
        : [state, { buffer: { bytes: action.bytes, type: "append" } }]
    case "request_failed":
      return state.acquisition === "backpressured"
        ? pause(state, action.error)
        : [state, { error: action.error }]
    case "request_finished": {
      return [{ ...state, acquisition: "idle" }, { buffer: { type: "end" } }]
    }
    case "request_retry": {
      const [next, effects] = project(
        { ...state, acquisition: "idle" },
        action.current,
      )
      return [
        next,
        complete(next, action.current)
          ? { ...effects, buffer: { type: "end" } }
          : { ...effects, control: effects.control ?? { type: "pause" } },
      ]
    }
    case "source_closed": {
      return [
        {
          ...state,
          resume: state.resume || !action.paused,
          target: state.pending_seek ?? action.position ?? state.target,
        },
        { control: { type: "rebuild" } },
      ]
    }
    case "source_opened": {
      const request = request_at(state.target)
      return [
        {
          ...state,
          acquisition: "active",
          buffer_low: BUFFER_LOW,
          pending_seek: state.target,
          request,
        },
        { control: { request, type: "request" }, seek: state.target },
      ]
    }
    case "buffered": {
      return [acknowledge(state, action.current), {}]
    }
    case "play":
      return [{ ...state, resume: false }, { play: false }]
    case "loadedmetadata":
    case "canplay":
    case "progress":
    case "playing":
    case "stalled":
    case "seeked":
    case "waiting": {
      return project(state, action.current)
    }
    case "ended": {
      const [next, effects] = request_if_needed(state, action.current)
      return [
        next,
        {
          ...effects,
          persist: at_end(action.current, action.current.time)
            ? 0
            : (state.pending_seek ??
              playable_time(action.current.duration, action.current.time)),
        },
      ]
    }
    case "timeupdate": {
      const { current } = action
      const persist =
        state.pending_seek === undefined
          ? buffered_position(current, current.time)
          : undefined
      const [next, effects] = project(state, current)
      return [next, persist === undefined ? effects : { ...effects, persist }]
    }
    case "error": {
      const { current } = action
      const [next, effects] = request_if_needed(state, current)
      if (
        current.error === undefined ||
        current.error.code === MediaError.MEDIA_ERR_ABORTED
      ) {
        return [next, effects]
      }
      return [
        {
          ...next,
          resume: state.resume || !current.paused,
          target:
            state.pending_seek ??
            (current.metadata
              ? playable_time(current.duration, current.time)
              : state.target),
        },
        { control: { type: "rebuild" }, error: current.error },
      ]
    }
    case "seeking": {
      const { current } = action
      const native = playable_time(current.duration, current.time)
      const target = buffered_position(current, native) ?? native

      if (
        state.pending_seek !== undefined &&
        aligned(current.time, state.pending_seek)
      ) {
        return project(state, current)
      }

      const end = buffered_end(current, target)
      const frontier =
        buffered_end(current, state.request.frontier) ?? state.request.frontier
      const restart = !aligned(end ?? target, frontier)
      const [next, effects] = project(
        {
          ...state,
          acquisition: restart ? "idle" : state.acquisition,
          pending_seek: undefined,
          request: restart ? request_at(end ?? target) : state.request,
          target,
        },
        current,
      )

      return [
        next,
        {
          ...effects,
          ...(restart &&
          effects.control === undefined &&
          state.acquisition !== "idle"
            ? { control: { type: "pause" } as const }
            : {}),
          persist: target,
        },
      ]
    }
    default:
      return never(action)
  }
}

export const playback_transitions = (
  position: number,
): ((action: PlaybackAction | readonly MediaAction[]) => PlaybackEffects) => {
  let state: PlaybackState = {
    acquisition: "idle",
    buffer_low: BUFFER_LOW,
    pending_seek: undefined,
    request: request_at(position),
    resume: false,
    target: position,
  }

  return (action) => {
    const actions = "type" in action ? [action] : action
    const seeking = actions.findLast(({ type }) => type === "seeking")
    let effects: PlaybackEffects = {}

    for (const current of actions) {
      if (current.type === "seeking" && current !== seeking) {
        continue
      }
      const [next, produced] = reduce(state, current)
      state = next
      effects =
        effects.control?.type === "rebuild"
          ? { ...effects, ...produced, control: effects.control }
          : { ...effects, ...produced }
      if (state.pending_seek === undefined && effects.seek !== undefined) {
        const { seek, ...remaining } = effects
        effects = remaining
      }
    }
    if (effects.control?.type === "rebuild" && effects.play) {
      state = { ...state, resume: true }
      const { play, ...remaining } = effects
      return remaining
    }
    return effects
  }
}

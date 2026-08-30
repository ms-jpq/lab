import { playable_time } from "./media.ts"
import type { MediaAction, MediaSnapshot } from "./media.ts"
import { never } from "./util.ts"

type PlaybackRequest = Readonly<{ frontier: number; position: number }>

type BufferEffect =
  | Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: "append" }>
  | Readonly<{ type: "end" }>

type PlaybackControl =
  | Readonly<{ error?: unknown; request: PlaybackRequest; type: "request" }>
  | Readonly<{ error: unknown; type: "rebuild" }>

type PlaybackState = Readonly<{
  pending_seek: number | undefined
  request: PlaybackRequest
  requesting: boolean
  target: number
}>

type PlaybackAction =
  | MediaAction
  | Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: "bytes_received" }>
  | Readonly<{ error: unknown; type: "request_failed" }>
  | Readonly<{ type: "request_finished" }>
  | Readonly<{ type: "source_opened" }>

type PlaybackEffects = Readonly<{
  buffer?: BufferEffect
  control?: PlaybackControl
  persist?: number
  seek?: number
}>

type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

const POSITION_TOLERANCE = 0.1
const BUFFER_LOW = 45
const BUFFER_HIGH = 60

const aligned = (left: number, right: number): boolean =>
  Math.abs(left - right) <= POSITION_TOLERANCE

const buffered_range = (
  { buffered }: MediaSnapshot,
  position: number,
  inclusive: boolean,
): readonly [start: number, end: number] | undefined =>
  buffered.find(
    ([start, end]) =>
      start - position <= POSITION_TOLERANCE &&
      (inclusive ? position <= end : position < end),
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

const stream_position = (value: number): number =>
  Math.round(value * 1_000) / 1_000

const request_at = (position: number): PlaybackRequest => ({
  frontier: stream_position(position),
  position,
})

const request_if_needed = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackTransition => {
  if (
    state.requesting ||
    play_ahead(current, state.request.position) >= BUFFER_LOW
  ) {
    return [state, {}]
  }
  return [
    { ...state, requesting: true },
    { control: { request: state.request, type: "request" } },
  ]
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

  const frontier = stream_position(
    buffered_end(current, state.request.frontier) ?? state.request.frontier,
  )
  const advance =
    !aligned(frontier, state.request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH
  const request = {
    frontier,
    position: advance ? frontier : state.request.position,
  }
  const [next, effects] = request_if_needed(
    {
      ...state,
      pending_seek,
      request,
      requesting: advance ? false : state.requesting,
    },
    current,
  )
  return [next, seek === undefined ? effects : { ...effects, seek }]
}

const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  switch (action.type) {
    case "bytes_received": {
      return [state, { buffer: { bytes: action.bytes, type: "append" } }]
    }
    case "request_failed": {
      const request = request_at(state.request.frontier)
      return [
        { ...state, request, requesting: true },
        { control: { error: action.error, request, type: "request" } },
      ]
    }
    case "request_finished": {
      return [{ ...state, requesting: false }, { buffer: { type: "end" } }]
    }
    case "source_opened": {
      const request = request_at(state.target)
      return [
        {
          ...state,
          pending_seek: state.target,
          request,
          requesting: true,
        },
        { control: { request, type: "request" }, seek: state.target },
      ]
    }
    case "loadedmetadata":
    case "canplay":
    case "progress":
    case "seeked":
    case "waiting": {
      return project(state, action.current)
    }
    case "ended": {
      const [next, effects] = request_if_needed(state, action.current)
      return [next, { ...effects, persist: 0 }]
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
      return [next, { control: { error: current.error, type: "rebuild" } }]
    }
    case "seeking": {
      const { current } = action
      const native = playable_time(current.duration, current.time)
      const buffered = buffered_position(current, native)
      const target = buffered ?? native

      if (
        state.pending_seek !== undefined &&
        aligned(current.time, state.pending_seek)
      ) {
        return project(state, current)
      }

      const restart =
        buffered === undefined && !aligned(target, state.request.frontier)
      const [next, effects] = project(
        {
          ...state,
          pending_seek: undefined,
          request: restart ? request_at(target) : state.request,
          requesting: restart ? false : state.requesting,
          target,
        },
        current,
      )

      return [next, { ...effects, persist: target }]
    }
    default:
      return never(action)
  }
}

export const playback_transitions = (
  position: number,
): ((action: PlaybackAction | readonly MediaAction[]) => PlaybackEffects) => {
  let state: PlaybackState = {
    pending_seek: undefined,
    request: request_at(position),
    requesting: false,
    target: position,
  }

  return (action) => {
    const actions = "type" in action ? [action] : action
    let effects: PlaybackEffects = {}

    for (const current of actions) {
      const [next, produced] = reduce(state, current)
      state = next
      effects =
        effects.control?.type === "rebuild"
          ? { ...effects, ...produced, control: effects.control }
          : { ...effects, ...produced }
    }
    return effects
  }
}

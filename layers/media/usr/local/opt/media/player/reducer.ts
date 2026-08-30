import { media_state, playable_time } from "./media.ts"
import type { MediaAction, MediaSnapshot } from "./media.ts"

type PlaybackRequest = Readonly<{
  frontier: number
  position: number
}>

type PlaybackState = Readonly<{
  current: MediaSnapshot
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
  append?: Uint8Array<ArrayBuffer>
  end?: true
  failure?: unknown
  persist?: number
  report?: unknown
  request?: PlaybackRequest
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

const request_needed = (
  current: MediaSnapshot,
  request: PlaybackRequest,
): boolean => play_ahead(current, request.position) < BUFFER_LOW

const reconcile_seek = (
  current: MediaSnapshot,
  pending_seek: number | undefined,
): readonly [pending_seek: number | undefined, seek: number | undefined] => {
  if (pending_seek === undefined || current.seeking) {
    return [pending_seek, undefined]
  }

  const position =
    buffered_position(current, pending_seek) ??
    (current.metadata ? pending_seek : undefined)

  if (position === undefined) {
    return [pending_seek, undefined]
  }
  return aligned(current.time, position)
    ? [undefined, undefined]
    : [position, position]
}

const project_request = (
  current: MediaSnapshot,
  request: PlaybackRequest,
): PlaybackRequest => {
  const frontier = stream_position(
    buffered_end(current, request.frontier) ?? request.frontier,
  )
  const advance =
    !aligned(frontier, request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH

  const position = advance ? frontier : request.position
  return { frontier, position }
}

const observe = (state: PlaybackState): PlaybackTransition => {
  const { current } = state
  const [pending_seek, seek] = reconcile_seek(current, state.pending_seek)
  const request = project_request(current, state.request)
  const restart = !aligned(request.position, state.request.position)
  const requesting = restart ? false : state.requesting
  const start = !requesting && request_needed(current, request)

  return [
    {
      ...state,
      pending_seek,
      request,
      requesting: requesting || start,
    },
    {
      ...(start ? { request } : {}),
      ...(seek === undefined ? {} : { seek }),
    },
  ]
}

const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  const observed =
    "current" in action ? { ...state, current: action.current } : state
  const { current } = observed
  const start = !state.requesting && request_needed(current, state.request)

  switch (action.type) {
    case "bytes_received": {
      return [state, { append: action.bytes }]
    }
    case "request_failed": {
      const request = {
        ...state.request,
        position: state.request.frontier,
      }
      return [
        { ...state, request, requesting: true },
        { report: action.error, request },
      ]
    }
    case "request_finished": {
      return [{ ...state, requesting: false }, { end: true }]
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
        { request, seek: state.target },
      ]
    }
    case "loadedmetadata":
    case "canplay":
    case "progress":
    case "seeked":
    case "waiting": {
      return observe(observed)
    }
    case "ended": {
      return [
        { ...observed, requesting: state.requesting || start },
        { persist: 0, ...(start ? { request: state.request } : {}) },
      ]
    }
    case "timeupdate": {
      const persist =
        state.pending_seek === undefined
          ? buffered_position(current, current.time)
          : undefined
      const [next, effects] = observe(observed)
      return [
        next,
        {
          ...effects,
          ...(persist === undefined ? {} : { persist }),
        },
      ]
    }
    case "error": {
      const { error } = current
      return [
        { ...observed, requesting: state.requesting || start },
        {
          ...(error !== undefined && error.code !== MediaError.MEDIA_ERR_ABORTED
            ? { failure: error }
            : {}),
          ...(start ? { request: state.request } : {}),
        },
      ]
    }
    case "seeking": {
      const native = playable_time(current.duration, current.time)
      const buffered = buffered_position(current, native)
      const target = buffered ?? native
      const external =
        state.pending_seek === undefined ||
        !aligned(current.time, state.pending_seek)

      if (!external) {
        return observe(observed)
      }

      const restart =
        buffered === undefined && !aligned(target, state.request.frontier)
      const [next, effects] = observe({
        ...observed,
        pending_seek: undefined,
        request: restart ? request_at(target) : state.request,
        requesting: restart ? false : state.requesting,
        target,
      })

      return [next, { ...effects, persist: target }]
    }
    default:
      throw new Error(action)
  }
}

export const playback_transitions = (
  media: HTMLMediaElement,
  position: number,
): ((
  action: PlaybackAction | readonly PlaybackAction[],
) => PlaybackEffects) => {
  let state: PlaybackState = {
    current: media_state(media),
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
      effects = {
        ...effects,
        ...produced,
        ...(effects.failure === undefined ? {} : { failure: effects.failure }),
      }
    }
    return effects
  }
}

import { closing, events, merge } from "./util.ts"

type BufferedRange = readonly [start: number, end: number]

type MediaSnapshot = Readonly<{
  buffered: readonly BufferedRange[]
  duration: number
  error: MediaError | undefined
  metadata: boolean
  seeking: boolean
  time: number
}>

type PlaybackRequest = Readonly<{
  frontier: number
  needed: boolean
  position: number
}>

type PlaybackState = Readonly<{
  current: MediaSnapshot
  pending_seek: number | undefined
  request: PlaybackRequest
  requesting: boolean
  target: number
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

type MediaAction = Readonly<{
  current: MediaSnapshot
  type: MediaEvent
}>

type PlaybackAction =
  | MediaAction
  | Readonly<{ bytes: Uint8Array<ArrayBuffer>; type: "bytes_received" }>
  | Readonly<{ error: unknown; type: "request_failed" }>
  | Readonly<{ type: "request_finished" }>
  | Readonly<{ type: "source_opened" }>

type RequestInterruption = Readonly<{ type: "request" }>

type PlaybackInterruption =
  RequestInterruption | Readonly<{ error: unknown; type: "failure" }>

type PlaybackEffects = Readonly<{
  append?: Uint8Array<ArrayBuffer> | undefined
  end?: boolean | undefined
  interrupt?: PlaybackInterruption | undefined
  persist?: number | undefined
  report?: unknown
  request?: PlaybackRequest | undefined
  seek?: number | undefined
}>

type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

const POSITION_TOLERANCE = 0.1
const END_TOLERANCE = 0.5
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
  if (range === undefined) {
    return undefined
  }
  const [start] = range
  return Math.max(position, start)
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

const request_at = (
  current: MediaSnapshot,
  position: number,
): PlaybackRequest => ({
  frontier: stream_position(position),
  needed: play_ahead(current, position) < BUFFER_LOW,
  position,
})

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

const initial_playback = (
  media: HTMLMediaElement,
  position: number,
): PlaybackState => {
  const current = capture(media)
  return {
    current,
    pending_seek: undefined,
    request: request_at(current, position),
    requesting: false,
    target: position,
  }
}

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
): readonly [
  request: PlaybackRequest,
  interrupt: RequestInterruption | undefined,
] => {
  const frontier = stream_position(
    buffered_end(current, request.frontier) ?? request.frontier,
  )
  const advance =
    !aligned(frontier, request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH

  const position = advance ? frontier : request.position
  return [
    { frontier, needed: play_ahead(current, position) < BUFFER_LOW, position },
    advance ? { type: "request" } : undefined,
  ]
}

const observe = (
  state: PlaybackState,
  current: MediaSnapshot,
): PlaybackTransition => {
  const [pending_seek, seek] = reconcile_seek(current, state.pending_seek)
  const [request, interrupt] = project_request(current, state.request)

  return [
    { ...state, current, pending_seek, request },
    { interrupt, seek },
  ]
}

const media_transition = (
  state: PlaybackState,
  action: MediaAction | Readonly<{ type: "source_opened" }>,
): PlaybackTransition => {
  switch (action.type) {
    case "source_opened": {
      return [
        {
          ...state,
          pending_seek: state.target,
          request: request_at(state.current, state.target),
        },
        { seek: state.target },
      ]
    }
    case "loadedmetadata":
    case "canplay":
    case "progress":
    case "seeked":
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
      const [next, effects] = action.current.seeking
        ? media_transition(state, { ...action, type: "seeking" })
        : ([{ ...state, current: action.current }, {}] as const)
      const failure =
        error !== undefined && error.code !== MediaError.MEDIA_ERR_ABORTED
          ? { error, type: "failure" as const }
          : undefined

      return [
        next,
        { ...effects, interrupt: failure ?? effects.interrupt },
      ]
    }
    case "seeking": {
      const { current } = action
      const native = playable_time(current.duration, current.time)

      const buffered = buffered_position(current, native)
      const target = buffered ?? native

      const external =
        state.pending_seek === undefined ||
        !aligned(current.time, state.pending_seek)

      if (!external) {
        return observe(state, current)
      }

      const restart =
        buffered === undefined && !aligned(target, state.request.frontier)

      const [next, effects] = observe(
        {
          ...state,
          pending_seek: undefined,
          request: restart ? request_at(current, target) : state.request,
          target,
        },
        current,
      )

      return [
        next,
        {
          ...effects,
          interrupt: restart ? { type: "request" } : effects.interrupt,
          persist: target,
        },
      ]
    }
    default:
      throw new Error(action)
  }
}

const schedule = ([state, effects]: PlaybackTransition): PlaybackTransition => {
  if (effects.interrupt?.type === "request") {
    const request = state.request.needed ? state.request : undefined
    return [
      { ...state, requesting: request !== undefined },
      {
        ...effects,
        interrupt: undefined,
        request,
      },
    ]
  }
  if (state.request.needed && !state.requesting) {
    return [
      { ...state, requesting: true },
      { ...effects, request: state.request },
    ]
  }
  return [state, effects]
}

const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
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
      return schedule(media_transition({ ...state, requesting: false }, action))
    }
    default: {
      return schedule(media_transition(state, action))
    }
  }
}

export const playback_transitions = (
  media: HTMLMediaElement,
  position: number,
): ((action: PlaybackAction) => PlaybackEffects) => {
  let state = initial_playback(media, position)

  return (action) => {
    const [next, effects] = reduce(state, action)
    state = next
    return effects
  }
}

export const playback_events = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<PlaybackAction> =>
  closing(signal, (signal) => {
    const streams = EVENTS.map((type) =>
      (async function* () {
        for await (const _ of events(signal, media, type)) {
          yield { current: capture(media), type }
        }
        return
      })(),
    )

    return (async function* () {
      if (signal.aborted) {
        return
      }
      yield { type: "source_opened" } as const
      for await (const [, action] of merge(...streams)) {
        yield action
      }
      return
    })()
  })

import { closing } from "./util.ts"

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

type PlaybackEffects = Readonly<{
  append?: Uint8Array<ArrayBuffer> | undefined
  end?: boolean | undefined
  failure?: unknown
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
): readonly [request: PlaybackRequest, restart: boolean] => {
  const frontier = stream_position(
    buffered_end(current, request.frontier) ?? request.frontier,
  )
  const advance =
    !aligned(frontier, request.position) &&
    play_ahead(current, frontier) >= BUFFER_HIGH

  const position = advance ? frontier : request.position
  return [
    { frontier, needed: play_ahead(current, position) < BUFFER_LOW, position },
    advance,
  ]
}

const observe = (state: PlaybackState): PlaybackTransition => {
  const { current } = state
  const [pending_seek, seek] = reconcile_seek(current, state.pending_seek)
  const [request, restart] = project_request(current, state.request)
  const requested = restart && request.needed

  return [
    {
      ...state,
      current,
      pending_seek,
      request,
      requesting: restart ? requested : state.requesting,
    },
    { request: requested ? request : undefined, seek },
  ]
}

const media_transition = (
  state: PlaybackState,
  action: MediaAction,
): PlaybackTransition => {
  const observed = { ...state, current: action.current }
  const { current } = observed

  switch (action.type) {
    case "loadedmetadata":
    case "canplay":
    case "progress":
    case "seeked":
    case "waiting": {
      return observe(observed)
    }
    case "ended": {
      return [observed, { persist: 0 }]
    }
    case "timeupdate": {
      const persist =
        state.pending_seek === undefined
          ? buffered_position(current, current.time)
          : undefined

      const [next, effects] = observe(observed)
      return [next, { ...effects, persist }]
    }
    case "error": {
      const { error } = current
      return [
        observed,
        {
          failure:
            error !== undefined && error.code !== MediaError.MEDIA_ERR_ABORTED
              ? error
              : undefined,
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
        request: restart ? request_at(current, target) : state.request,
        target,
      })

      return [
        next,
        {
          ...effects,
          persist: target,
          request: restart ? next.request : effects.request,
        },
      ]
    }
    default:
      throw new Error(action)
  }
}

const schedule = ([state, effects]: PlaybackTransition): PlaybackTransition => {
  if (effects.request !== undefined) {
    return [{ ...state, requesting: true }, effects]
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
      const request = request_at(state.current, state.target)
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
    default: {
      return schedule(media_transition(state, action))
    }
  }
}

export const playback_transitions = (
  media: HTMLMediaElement,
  position: number,
): ((
  action: PlaybackAction | readonly PlaybackAction[],
) => PlaybackEffects) => {
  let state = initial_playback(media, position)

  return (action) => {
    const actions = "type" in action ? [action] : action
    let effects: PlaybackEffects = {}

    for (const current of actions) {
      const [next, produced] = reduce(state, current)
      state = next
      effects = {
        append: produced.append ?? effects.append,
        end: produced.end ?? effects.end,
        failure: effects.failure ?? produced.failure,
        persist: produced.persist ?? effects.persist,
        report: produced.report ?? effects.report,
        request: produced.request ?? effects.request,
        seek: produced.seek ?? effects.seek,
      }
    }
    return effects
  }
}

export const playback_events = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<readonly PlaybackAction[]> =>
  closing(signal, async function* (signal) {
    if (signal.aborted) {
      return
    }

    const pending: PlaybackAction[] = []
    let ready = Promise.withResolvers<void>()

    signal.addEventListener("abort", () => ready.resolve(), { once: true })
    for (const type of EVENTS) {
      media.addEventListener(
        type,
        () => {
          pending.push({ current: capture(media), type })
          ready.resolve()
        },
        { signal },
      )
    }

    while (!signal.aborted) {
      if (pending.length === 0) {
        await ready.promise
      }
      if (signal.aborted) {
        return
      }

      const batch = pending.splice(0)
      ready = Promise.withResolvers<void>()
      yield batch
    }
    return
  })

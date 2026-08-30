import {
  aligned,
  buffered_position,
  playable_time,
  type MediaSnapshot,
} from "./media.ts"
import { abortion, event_batches, type EventObservation } from "./util.ts"

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
  seeking: boolean
}>
type MediaResume =
  | Readonly<{ reason: "ended"; position: 0 }>
  | Readonly<{ reason: "progress"; position: number }>
export type MediaDerived = Readonly<{
  failure: MediaError | undefined
  resume: MediaResume | undefined
  seeks: readonly MediaSeek[]
}>
export type MediaState = Readonly<{
  current: MediaSnapshot
  derived: MediaDerived
}>

type PendingSeek = Readonly<{
  acknowledged: boolean
  target: MediaTarget
}>
export type PlaybackState = Readonly<{
  current: MediaSnapshot
  failure: MediaError | undefined
  pending_seek: PendingSeek | undefined
  target: MediaTarget
}>
export type PlaybackAction =
  | Readonly<{ kind: "consume_failure" }>
  | Readonly<{ kind: "media"; value: MediaState }>
  | Readonly<{ kind: "seek"; target: MediaTarget }>
export type PlaybackEffects = Readonly<{
  persist: number | undefined
  seek: number | undefined
}>
export type PlaybackTransition = Readonly<{
  effects: PlaybackEffects
  state: PlaybackState
}>

export const initial_playback = (
  position: number,
  { current, derived }: MediaState,
): PlaybackState => {
  const target = { position, restart: false }
  return {
    current,
    failure: derived.failure,
    pending_seek: { target, acknowledged: false },
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

const derive = (
  media: HTMLMediaElement,
  previous: MediaState | undefined,
  observations: readonly MediaObservation[],
): MediaState => {
  const current =
    observations.at(-1)?.[0] ?? previous?.current ?? capture(media)
  const ended = observations.some(([, event]) => event.type === "ended")
  const moved = observations.some(([, event]) =>
    ["seeked", "seeking", "timeupdate"].includes(event.type),
  )

  const resume = ended
    ? ({ reason: "ended", position: 0 } as const)
    : moved && buffered_position(current, current.time) === current.time
      ? ({ reason: "progress", position: current.time } as const)
      : undefined

  const failure = observations.find(
    ([{ error }, event]) =>
      event.type === "error" &&
      error !== undefined &&
      error.code !== MediaError.MEDIA_ERR_ABORTED,
  )?.[0].error

  const seeks = observations.flatMap(([snapshot, event]) => {
    if (event.type !== "seeked" && event.type !== "seeking") return []

    const { duration, seeking, time } = snapshot
    const native = playable_time(duration, time)
    const position = buffered_position(snapshot, native)
    return [
      {
        candidate: {
          position: position ?? native,
          restart: position === undefined,
        },
        position: time,
        seeking,
      },
    ]
  })

  return { current, derived: { failure, resume, seeks } }
}

export const reduce = (
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackTransition => {
  if (action.kind === "consume_failure") {
    return {
      effects: { persist: undefined, seek: undefined },
      state: { ...state, failure: undefined },
    }
  }

  if (action.kind === "seek") {
    return {
      effects: { persist: undefined, seek: action.target.position },
      state: {
        ...state,
        pending_seek: { target: action.target, acknowledged: false },
      },
    }
  }

  const { current, derived } = action.value
  const { failure, resume, seeks } = derived
  let target = state.target
  let pending_seek = state.pending_seek
  let persist: number | undefined
  let seek: number | undefined

  const pending = pending_seek
  if (
    pending !== undefined &&
    seeks.some(({ position }) => aligned(position, pending.target.position))
  ) {
    pending_seek = { ...pending, acknowledged: true }
  }
  const external_seek = seeks.findLast(
    ({ position, seeking }) =>
      seeking &&
      (pending === undefined || !aligned(position, pending.target.position)),
  )
  const retargeted = external_seek !== undefined
  if (external_seek !== undefined) target = external_seek.candidate

  const { metadata, seeking, time } = current
  if (retargeted) {
    pending_seek =
      target.restart || !aligned(time, target.position)
        ? { target, acknowledged: false }
        : undefined
    persist = target.position
  }
  if (
    resume !== undefined &&
    (resume.reason === "ended" || (!retargeted && pending_seek === undefined))
  ) {
    persist = resume.position
  }
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

  return {
    effects: { persist, seek },
    state: {
      current,
      failure: state.failure ?? failure,
      pending_seek,
      target,
    },
  }
}

export const media_states = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaState> =>
  (async function* (): AsyncIteratorObject<MediaState> {
    using a = abortion(signal)
    if (a.signal.aborted) return

    const events = event_batches(a.signal, media, EVENTS, () => capture(media))
    let pending = events.next()
    let state = derive(media, undefined, [])
    yield state
    for (;;) {
      const next = await pending
      if (next.done) return
      pending = events.next()
      state = derive(media, state, next.value)
      yield state
    }
  })()

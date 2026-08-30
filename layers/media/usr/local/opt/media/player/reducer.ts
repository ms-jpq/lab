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
}>
type MediaResume =
  | Readonly<{ reason: "ended"; position: 0 }>
  | Readonly<{ reason: "progress"; position: number }>
export type MediaDerived = Readonly<{
  failure: MediaError | undefined
  resume: MediaResume | undefined
  seek: MediaSeek | undefined
}>
export type MediaState = Readonly<{
  kind: "media"
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
  | MediaState
  | Readonly<{ kind: "seek"; target: MediaTarget }>
export type PlaybackEffects = Readonly<{
  persist: number | undefined
  seek: number | undefined
}>
export type PlaybackTransition = readonly [
  state: PlaybackState,
  effects: PlaybackEffects,
]

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

  const resume = observations.some(([, event]) => event.type === "ended")
    ? ({ reason: "ended", position: 0 } as const)
    : observations.some(([, event]) =>
          ["seeked", "seeking", "timeupdate"].includes(event.type),
        ) && buffered_position(current, current.time) === current.time
      ? ({ reason: "progress", position: current.time } as const)
      : undefined

  const failure = observations.find(
    ([{ error }, event]) =>
      event.type === "error" &&
      error !== undefined &&
      error.code !== MediaError.MEDIA_ERR_ABORTED,
  )?.[0].error

  const seek = (() => {
    const observation = observations.findLast(
      ([, event]) => event.type === "seeked" || event.type === "seeking",
    )
    if (observation === undefined) {
      return undefined
    }

    const [snapshot] = observation
    const { duration, time } = snapshot
    const native = playable_time(duration, time)
    const position = buffered_position(snapshot, native)
    return {
      candidate: {
        position: position ?? native,
        restart: position === undefined,
      },
      position: time,
    }
  })()

  return { kind: "media", current, derived: { failure, resume, seek } }
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
    case "seek": {
      return [
        {
          ...state,
          pending_seek: { target: action.target, acknowledged: false },
        },
        { persist: undefined, seek: action.target.position },
      ]
    }
    case "media": {
      const {
        current,
        derived: { failure, resume, seek: observed_seek },
      } = action
      const pending = state.pending_seek

      const owned_seek =
        pending !== undefined &&
        observed_seek !== undefined &&
        aligned(observed_seek.position, pending.target.position)
      const external_seek = owned_seek ? undefined : observed_seek
      const target = external_seek?.candidate ?? state.target

      let pending_seek = owned_seek
        ? { ...pending, acknowledged: true }
        : pending
      let seek: number | undefined

      const { metadata, seeking, time } = current
      if (external_seek !== undefined) {
        pending_seek =
          target.restart || !aligned(time, target.position)
            ? { target, acknowledged: false }
            : undefined
      }

      const persist =
        resume !== undefined &&
        (resume.reason === "ended" ||
          (external_seek === undefined && pending_seek === undefined))
          ? resume.position
          : external_seek?.candidate.position

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

      return [
        {
          current,
          failure: state.failure ?? failure,
          pending_seek,
          target,
        },
        { persist, seek },
      ]
    }
  }
}

export const media_states = (
  media: HTMLMediaElement,
  signal: AbortSignal,
): AsyncIteratorObject<MediaState> =>
  (async function* (): AsyncIteratorObject<MediaState> {
    using a = abortion(signal)
    if (a.signal.aborted) {
      return
    }

    const events = event_batches(a.signal, media, EVENTS, () => capture(media))
    let pending = events.next()
    let state = derive(media, undefined, [])
    yield state
    for (;;) {
      const next = await pending
      if (next.done) {
        return
      }
      pending = events.next()
      state = derive(media, state, next.value)
      yield state
    }
  })()

import {
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

const capture = (media: HTMLMediaElement): MediaSnapshot => ({
  buffered: Array.from(
    { length: media.buffered.length },
    (_, index) =>
      [media.buffered.start(index), media.buffered.end(index)] as const,
  ),
  duration: Number(media.dataset["duration"]),
  ended: media.ended,
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

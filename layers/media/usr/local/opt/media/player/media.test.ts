import { deepEqual, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import type { TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"

import { media_buffered, media_events, playable_position } from "./media.ts"
import { EventTarget, Ranges, run_cases } from "./test_utils.ts"

class Media extends EventTarget {
  readonly HAVE_METADATA = 1
  readonly HAVE_FUTURE_DATA = 3
  readonly buffered = new Ranges()
  readonly dataset = { duration: "200" } as DOMStringMap
  currentTime = 0
  duration = Number.NaN
  ended = false
  error: MediaError | null = null
  paused = false
  readyState = 0
  seeking = false
}

const observations = (
  context: TestContext,
): {
  owner: AbortController
  media: Media
  states: ReturnType<typeof media_events>
} => {
  const owner = new AbortController()
  const media = new Media()
  const states = media_events(
    media as unknown as HTMLMediaElement,
    owner.signal,
  )
  context.after(async () => {
    owner.abort()
    await states.return?.()
  })
  return {
    owner,
    media,
    states,
  }
}

const cases = [
  ...["0", "200"].map((declared) => ({
    name: `duration ${declared} follows native initialization, completion, reopening, and replacement`,
    run: async (): Promise<void> => {
      const media = new Media()
      media.dataset["duration"] = declared
      const element = media as unknown as HTMLMediaElement
      // Unknown initialization duration is Infinity; normal EOF supplies the
      // buffered end. Reopening preserves it, while a new resource resets it.
      // https://www.w3.org/TR/media-source-2/#initialization-segment-received
      // https://html.spec.whatwg.org/multipage/media.html#media-element-load-algorithm
      const phases = [
        { name: "before metadata", duration: Number.NaN },
        { name: "unknown-duration initialization", duration: Infinity },
        { name: "first EOF", duration: 10 },
        { name: "reopened source", duration: 10 },
        { name: "replacement before metadata", duration: Number.NaN },
        { name: "replacement initialization", duration: Infinity },
        { name: "replacement EOF", duration: 20 },
      ]
      for (const phase of phases) {
        media.duration = phase.duration
        media.readyState = Number.isNaN(phase.duration)
          ? 0
          : media.HAVE_METADATA
        const snapshot = media_buffered(element).current
        const expected = declared === "200" ? 200 : phase.duration
        deepEqual(snapshot.duration, expected, phase.name)
        deepEqual(snapshot.metadata, !Number.isNaN(phase.duration), phase.name)
        deepEqual(
          playable_position(element, 37),
          declared === "0" && Number.isFinite(expected) ? expected - 0.5 : 37,
          phase.name,
        )
      }
    },
  })),
  ...["200", "0", ""].map((declared) => ({
    name: `duration ${JSON.stringify(declared)} uses native duration only as a fallback`,
    run: async (): Promise<void> => {
      const media = Object.assign(new Media(), { duration: 10 })
      media.dataset["duration"] = declared
      const element = media as unknown as HTMLMediaElement
      const expected = declared === "200" ? 200 : 10
      deepEqual(media_buffered(element).current.duration, expected)
      deepEqual(playable_position(element, expected), expected - 0.5)
    },
  })),
  {
    name: "a pre-aborted owner produces no media states",
    run: async (): Promise<void> => {
      const owner = new AbortController()
      owner.abort()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )

      deepEqual(await states.next(), { done: true, value: undefined })
      media.dispatchEvent(new Event("progress"))
      deepEqual(getEventListeners(media, "progress").length, 0)
    },
  },
  {
    name: "owner abort completes a pending media-state pull",
    run: async (context: TestContext): Promise<void> => {
      const { owner, media, states } = observations(context)
      const pending = states.next()

      owner.abort()

      deepEqual(await Promise.race([pending, setImmediate("pending")]), {
        done: true,
        value: undefined,
      })
      deepEqual(getEventListeners(media, "timeupdate").length, 0)
      media.dispatchEvent(new Event("timeupdate"))
      deepEqual(await states.next(), { done: true, value: undefined })
    },
  },
  {
    name: "return completes a pending media-state pull",
    run: async (context: TestContext): Promise<void> => {
      const { media, states } = observations(context)
      const pending = states.next()
      const closed = states.return?.()
      ok(closed)

      deepEqual(
        await Promise.race([
          Promise.all([pending, closed]),
          setImmediate("pending"),
        ]),
        [
          { done: true, value: undefined },
          { done: true, value: undefined },
        ],
      )
      deepEqual(getEventListeners(media, "timeupdate").length, 0)
    },
  },
  {
    name: "return from media states detaches its event listeners",
    run: async (context: TestContext): Promise<void> => {
      const { media, states } = observations(context)
      const pending = states.next()
      media.dispatchEvent(new Event("progress"))
      const received = await pending
      ok(!received.done)
      const closed = states.return?.()
      ok(closed)

      deepEqual(await Promise.race([closed, setImmediate("pending")]), {
        done: true,
        value: undefined,
      })
      deepEqual(getEventListeners(media, "progress").length, 0)
      media.dispatchEvent(new Event("progress"))
      deepEqual(await states.next(), { done: true, value: undefined })
    },
  },
  {
    name: "queued media observations retain the state of each event while the consumer is suspended",
    run: async (context: TestContext): Promise<void> => {
      const { owner, media, states } = observations(context)
      try {
        const first = states.next()
        media.dispatchEvent(new Event("progress"))
        ok(!(await first).done)

        media.readyState = media.HAVE_METADATA
        media.currentTime = 10
        media.seeking = true
        const range: [number, number] = [10, 20]
        media.buffered.values.push(range)
        media.dispatchEvent(new Event("seeking"))
        await setImmediate()
        media.currentTime = 12
        media.seeking = false
        media.paused = true
        range.splice(0, 2, 12, 24)
        media.dispatchEvent(new Event("seeked"))
        await setImmediate()
        media.currentTime = 99
        media.buffered.values.length = 0

        const batch = await states.next()
        ok(!batch.done)
        deepEqual(batch.value, [
          {
            type: "seeking",
            current: {
              buffered: [[10, 20]],
              duration: 200,
              error: undefined,
              metadata: true,
              paused: false,
              seeking: true,
              time: 10,
            },
          },
          {
            type: "seeked",
            current: {
              buffered: [[12, 24]],
              duration: 200,
              error: undefined,
              metadata: true,
              paused: true,
              seeking: false,
              time: 12,
            },
          },
        ])
      } finally {
        owner.abort()
        await states.return?.()
      }
    },
  },
  {
    name: "owner abort discards media observations queued behind a suspended consumer",
    run: async (context: TestContext): Promise<void> => {
      const { owner, media, states } = observations(context)
      try {
        const first = states.next()
        media.dispatchEvent(new Event("progress"))
        ok(!(await first).done)
        media.dispatchEvent(new Event("seeking"))
        await setImmediate()
        media.dispatchEvent(new Event("seeked"))

        owner.abort()

        deepEqual(await states.next(), { done: true, value: undefined })
        deepEqual(getEventListeners(media, "seeking").length, 0)
        deepEqual(getEventListeners(media, "seeked").length, 0)
      } finally {
        owner.abort()
        await states.return?.()
      }
    },
  },
  {
    name: "an observation owns an immutable copy of buffered ranges",
    run: async (context: TestContext): Promise<void> => {
      const { media, states } = observations(context)
      const pending = states.next()

      const range: [number, number] = [10, 20]
      media.buffered.values.push(range)
      media.dispatchEvent(new Event("progress"))

      const observed = await pending
      ok(!observed.done)
      const [observation] = observed.value
      ok(observation)
      const { current: snapshot } = observation
      range.splice(0, 2, 30, 40)
      deepEqual(snapshot.buffered, [[10, 20]])
      await states.return?.()
    },
  },
] as const

await run_cases(cases)

import { deepEqual, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import nodeTest from "node:test"
import { setImmediate } from "node:timers/promises"

import { media_buffered, media_events, playable_position } from "./media.ts"

const options = { concurrency: true, timeout: 2_000 }

class Ranges implements TimeRanges {
  readonly values: [number, number][] = []

  get length(): number {
    return this.values.length
  }

  start(index: number): number {
    const range = this.values[index]
    ok(range)
    return range[0]
  }

  end(index: number): number {
    const range = this.values[index]
    ok(range)
    return range[1]
  }
}

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

const cases = [
  ...["0", "200"].map((declared) => ({
    name: `duration ${declared} follows native initialization, completion, reopening, and replacement`,
    run: () => {
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
    run: () => {
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
    run: async () => {
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
      try {
        const first = states.next()
        media.dispatchEvent(new Event("progress"))
        ok(!(await first).done)

        media.readyState = media.HAVE_METADATA
        media.currentTime = 10
        media.seeking = true
        media.buffered.values.push([10, 20])
        media.dispatchEvent(new Event("seeking"))
        await setImmediate()
        media.currentTime = 12
        media.seeking = false
        media.paused = true
        media.buffered.values[0]?.splice(0, 2, 12, 24)
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
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
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_events(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
      const pending = states.next()

      media.buffered.values.push([10, 20])
      media.dispatchEvent(new Event("progress"))

      const observed = await pending
      ok(!observed.done)
      const [observation] = observed.value
      ok(observation)
      const { current: snapshot } = observation
      media.buffered.values[0]?.splice(0, 2, 30, 40)
      deepEqual(snapshot.buffered, [[10, 20]])
      await states.return?.()
    },
  },
] as const

for (const current of cases) {
  nodeTest(current.name, options, current.run)
}

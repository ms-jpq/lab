import { deepEqual, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import nodeTest from "node:test"

import { media_events, media_states } from "./media.ts"

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
  readonly buffered = new Ranges()
  readonly dataset = { duration: "200" } as DOMStringMap
  currentTime = 0
  ended = false
  error: MediaError | null = null
  readyState = 0
  seeking = false
}

const fixture = (signal: AbortSignal) => {
  const media = new Media()
  const events = media_events(media as unknown as HTMLMediaElement, signal)
  return { events, media }
}

const cases = [
  {
    name: "synchronous events drain as one ordered FIFO batch",
    run: async () => {
      const owner = new AbortController()
      const { events, media } = fixture(owner.signal)
      const pending = events.next()

      media.dispatchEvent(new Event("timeupdate"))
      media.dispatchEvent(new Event("progress"))

      const received = await pending
      ok(!received.done)
      deepEqual(
        received.value.map(([, { type }]) => type),
        ["timeupdate", "progress"],
      )
      await events.return?.()
    },
  },
  {
    name: "a delivered batch stays stable and an event before the next pull forms the next batch",
    run: async () => {
      const owner = new AbortController()
      const { events, media } = fixture(owner.signal)
      const pending = events.next()
      media.dispatchEvent(new Event("timeupdate"))
      const first = await pending
      ok(!first.done)

      media.dispatchEvent(new Event("progress"))

      deepEqual(
        first.value.map(([, { type }]) => type),
        ["timeupdate"],
      )
      const second = await events.next()
      ok(!second.done)
      deepEqual(
        second.value.map(([, { type }]) => type),
        ["progress"],
      )
      await events.return?.()
    },
  },
  {
    name: "a pre-aborted owner produces a completed iterator",
    run: async () => {
      const owner = new AbortController()
      owner.abort()
      const { events, media } = fixture(owner.signal)

      deepEqual(await events.next(), { done: true, value: undefined })
      media.dispatchEvent(new Event("progress"))
      deepEqual(getEventListeners(media, "progress").length, 0)
    },
  },
  {
    name: "owner abort completes a pending pull and drops queued events",
    run: async () => {
      const owner = new AbortController()
      const { events, media } = fixture(owner.signal)
      const pending = events.next()
      media.dispatchEvent(new Event("progress"))

      owner.abort()

      deepEqual(await pending, { done: true, value: undefined })
      deepEqual(getEventListeners(media, "timeupdate").length, 0)
      media.dispatchEvent(new Event("timeupdate"))
      deepEqual(await events.next(), { done: true, value: undefined })
    },
  },
  {
    name: "return from a yielded batch detaches and ignores later events",
    run: async () => {
      const owner = new AbortController()
      const { events, media } = fixture(owner.signal)
      const pending = events.next()
      media.dispatchEvent(new Event("progress"))
      const received = await pending
      ok(!received.done)

      deepEqual(await events.return?.(), { done: true, value: undefined })
      deepEqual(getEventListeners(media, "progress").length, 0)
      media.dispatchEvent(new Event("progress"))
      deepEqual(await events.next(), { done: true, value: undefined })
    },
  },
  {
    name: "an observation owns an immutable copy of buffered ranges",
    run: async () => {
      const owner = new AbortController()
      const { events, media } = fixture(owner.signal)
      const pending = events.next()

      media.buffered.values.push([10, 20])
      media.dispatchEvent(new Event("progress"))

      const observed = await pending
      ok(!observed.done)
      const observation = observed.value.at(0)
      ok(observation)
      const [snapshot] = observation
      ok(snapshot)
      media.buffered.values[0]?.splice(0, 2, 30, 40)
      deepEqual(snapshot.buffered, [[10, 20]])
      await events.return?.()
    },
  },
  {
    name: "media state derives decision inputs from each event batch",
    run: async () => {
      const owner = new AbortController()
      const media = new Media()
      const states = media_states(
        media as unknown as HTMLMediaElement,
        owner.signal,
      )
      await states.next()
      const pending = states.next()

      media.currentTime = 12
      media.seeking = true
      media.dispatchEvent(new Event("seeking"))
      media.dispatchEvent(new Event("timeupdate"))
      media.ended = true
      media.dispatchEvent(new Event("ended"))

      const observed = await pending
      ok(!observed.done)
      deepEqual(
        {
          ended: observed.value.derived.ended,
          failure: observed.value.derived.failure,
          moved: observed.value.derived.moved,
          seeks: observed.value.derived.seeks.map(([, event]) => event.type),
        },
        {
          ended: true,
          failure: undefined,
          moved: true,
          seeks: ["seeking"],
        },
      )
      await states.return?.()
    },
  },
] as const

for (const current of cases) {
  nodeTest(current.name, options, current.run)
}

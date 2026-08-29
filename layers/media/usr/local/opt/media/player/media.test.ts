import { deepEqual, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import nodeTest from "node:test"

import { media_events, media_state } from "./media.ts"

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

const state_fixture = (position = 0) => {
  const owner = new AbortController()
  const media = new Media()
  const persisted: number[] = []
  const states = media_state(media as unknown as HTMLMediaElement, {
    persist: (value) => persisted.push(value),
    position,
    signal: owner.signal,
  })
  return { media, owner, persisted, states }
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
    name: "media state retains the latest native seek in one batch",
    run: async () => {
      const { media, persisted, states } = state_fixture()
      const initial = await states.next()
      ok(!initial.done)
      const pending = states.next()

      media.currentTime = 20
      media.seeking = true
      media.dispatchEvent(new Event("seeking"))
      media.currentTime = 30
      media.dispatchEvent(new Event("seeking"))

      const observed = await pending
      ok(!observed.done)
      deepEqual(observed.value.target, { position: 30, restart: true })
      deepEqual(persisted, [30])
      await states.return(undefined)
    },
  },
  {
    name: "media state releases an owned seek only after acknowledgement",
    run: async () => {
      const { media, persisted, states } = state_fixture(40)
      media.buffered.values.push([0, 100])
      const initial = await states.next()
      ok(!initial.done)
      initial.value.seek()
      const acknowledgement = states.next()

      media.seeking = true
      media.dispatchEvent(new Event("seeking"))
      media.seeking = false
      media.dispatchEvent(new Event("seeked"))

      ok(!(await acknowledgement).done)
      deepEqual(persisted, [])
      const progress = states.next()
      media.currentTime = 41
      media.dispatchEvent(new Event("timeupdate"))
      ok(!(await progress).done)
      deepEqual(persisted, [41])
      await states.return(undefined)
    },
  },
  {
    name: "media state abort completes a pending pull",
    run: async () => {
      const { media, owner, states } = state_fixture()
      ok(!(await states.next()).done)
      const pending = states.next()

      owner.abort()

      deepEqual(await pending, { done: true, value: undefined })
      deepEqual(getEventListeners(media, "seeking").length, 0)
    },
  },
] as const

for (const current of cases) {
  nodeTest(current.name, options, current.run)
}

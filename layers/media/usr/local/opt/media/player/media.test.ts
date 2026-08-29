import { deepEqual, ok } from "node:assert/strict"
import nodeTest from "node:test"

import { media_events } from "./media.ts"

const options = { concurrency: true, timeout: 2_000 }

class Media extends EventTarget {
  deliveries = 0

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const tracked = (event: Event): void => {
      this.deliveries += 1
      if (typeof listener === "function") {
        listener.call(this, event)
      } else {
        listener?.handleEvent(event)
      }
    }
    super.addEventListener(type, tracked, options)
  }
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
        received.value.map(({ type }) => type),
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
        first.value.map(({ type }) => type),
        ["timeupdate"],
      )
      const second = await events.next()
      ok(!second.done)
      deepEqual(
        second.value.map(({ type }) => type),
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
      deepEqual(media.deliveries, 0)
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
      const deliveries = media.deliveries
      media.dispatchEvent(new Event("timeupdate"))
      deepEqual(media.deliveries, deliveries)
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
      const deliveries = media.deliveries
      media.dispatchEvent(new Event("progress"))
      deepEqual(media.deliveries, deliveries)
      deepEqual(await events.next(), { done: true, value: undefined })
    },
  },
] as const

for (const current of cases) {
  nodeTest(current.name, options, current.run)
}

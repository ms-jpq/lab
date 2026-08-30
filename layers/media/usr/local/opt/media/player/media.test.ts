import { deepEqual, ok } from "node:assert/strict"
import { getEventListeners } from "node:events"
import nodeTest from "node:test"

import { initial_playback, media_events, reduce } from "./reducer.ts"

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

const cases = [
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

      deepEqual(await pending, { done: true, value: undefined })
      deepEqual(getEventListeners(media, "timeupdate").length, 0)
      media.dispatchEvent(new Event("timeupdate"))
      deepEqual(await states.next(), { done: true, value: undefined })
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

      deepEqual(await states.return?.(), { done: true, value: undefined })
      deepEqual(getEventListeners(media, "progress").length, 0)
      media.dispatchEvent(new Event("progress"))
      deepEqual(await states.next(), { done: true, value: undefined })
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
      const [state] = reduce(
        initial_playback(media as unknown as HTMLMediaElement, 0),
        observed.value,
      )
      const { current: snapshot } = state
      media.buffered.values[0]?.splice(0, 2, 30, 40)
      deepEqual(snapshot.buffered, [[10, 20]])
      await states.return?.()
    },
  },
] as const

for (const current of cases) {
  nodeTest(current.name, options, current.run)
}

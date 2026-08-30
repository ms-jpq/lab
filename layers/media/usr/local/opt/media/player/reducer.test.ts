import { deepEqual } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"

import type { MediaSnapshot } from "./media.ts"
import { playback_transitions } from "./reducer.ts"

type Dispatch = ReturnType<typeof playback_transitions>
type Effects = ReturnType<Dispatch>
type Input = Parameters<Dispatch>[0]
type Step = Readonly<{ action: Input; expected: Effects }>
type Case = Readonly<{
  name: string
  position?: number
  steps: readonly Step[]
}>

const options = { concurrency: true, timeout: 2_000 }
const failure = new Error("transport failed")

const ranges = (
  values: readonly (readonly [number, number])[] = [],
): TimeRanges => ({
  length: values.length,
  end: (index) => values[index]![1],
  start: (index) => values[index]![0],
})

const snapshot = (overrides: Partial<MediaSnapshot> = {}): MediaSnapshot => ({
  buffered: [],
  duration: 200,
  error: undefined,
  metadata: true,
  seeking: false,
  time: 0,
  ...overrides,
})

class Media {
  readonly HAVE_METADATA = 1
  readonly buffered = ranges()
  readonly dataset = { duration: "200" } as DOMStringMap
  currentTime = 0
  error: MediaError | null = null
  readyState = this.HAVE_METADATA
  seeking = false
}

const cases = [
  {
    name: "source opening describes startup without touching media",
    position: 40,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          request: { frontier: 40, position: 40 },
          seek: 40,
        },
      },
    ],
  },
  {
    name: "the low-water threshold does not request more data",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      { action: { type: "request_finished" }, expected: { end: true } },
      {
        action: {
          current: snapshot({ buffered: [[0, 45]] }),
          type: "progress",
        },
        expected: {},
      },
    ],
  },
  {
    name: "below low water requests from the current stream",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      { action: { type: "request_finished" }, expected: { end: true } },
      {
        action: {
          current: snapshot({ buffered: [[0, 44]] }),
          type: "progress",
        },
        expected: { request: { frontier: 44, position: 0 } },
      },
    ],
  },
  {
    name: "low water resumes at an advanced buffered frontier",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      {
        action: {
          current: snapshot({ buffered: [[0, 60]] }),
          type: "progress",
        },
        expected: {},
      },
      {
        action: {
          current: snapshot({ buffered: [[0, 60]], time: 20 }),
          type: "timeupdate",
        },
        expected: {
          persist: 20,
          request: { frontier: 60, position: 60 },
        },
      },
    ],
  },
  {
    name: "an external unbuffered seek retargets acquisition",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      {
        action: { current: snapshot(), type: "seeked" },
        expected: {},
      },
      {
        action: {
          current: snapshot({ seeking: true, time: 110 }),
          type: "seeking",
        },
        expected: {
          persist: 110,
          request: { frontier: 110, position: 110 },
        },
      },
    ],
  },
  {
    name: "a failed request reports and retries from its frontier",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      {
        action: { error: failure, type: "request_failed" },
        expected: {
          error: failure,
          request: { frontier: 0, position: 0 },
        },
      },
    ],
  },
  {
    name: "a batch folds independent effects",
    steps: [
      {
        action: { type: "source_opened" },
        expected: { request: { frontier: 0, position: 0 }, seek: 0 },
      },
      {
        action: { current: snapshot(), type: "seeked" },
        expected: {},
      },
      { action: { type: "request_finished" }, expected: { end: true } },
      {
        action: [
          { bytes: new Uint8Array([1]), type: "bytes_received" },
          {
            current: snapshot({ buffered: [[0, 20]], time: 10 }),
            type: "timeupdate",
          },
        ],
        expected: {
          append: new Uint8Array([1]),
          persist: 10,
          request: { frontier: 20, position: 0 },
        },
      },
    ],
  },
] as const satisfies readonly Case[]

const shuffled: readonly Case[] = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all(
  shuffled.map(({ name, position = 0, steps }) =>
    nodeTest(name, options, () => {
      const media = new Media()
      const dispatch = playback_transitions(
        media as unknown as HTMLMediaElement,
        position,
      )

      for (const { action, expected } of steps) {
        deepEqual(dispatch(action), expected)
        deepEqual(media.currentTime, 0)
      }
    }),
  ),
)

import { deepEqual, equal } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import nodeTest from "node:test"

import type { MediaSnapshot } from "./media.ts"
import { BUFFER_HIGH, BUFFER_LOW, playback_transitions } from "./reducer.ts"

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
const RESUME_AT = BUFFER_HIGH - BUFFER_LOW + 1

Object.defineProperty(globalThis, "MediaError", {
  value: { MEDIA_ERR_ABORTED: 1 },
})

const snapshot = (overrides: Partial<MediaSnapshot> = {}): MediaSnapshot => ({
  buffered: [],
  duration: 200,
  error: undefined,
  metadata: true,
  paused: true,
  seeking: false,
  time: 0,
  ...overrides,
})

const quota_steps: readonly Step[] = [
  {
    action: { type: "source_opened" },
    expected: {
      control: { type: "request", request: { frontier: 40, position: 40 } },
      seek: 40,
    },
  },
  { action: { type: "seeked", current: snapshot({ time: 40 }) }, expected: {} },
  {
    action: {
      type: "buffered",
      current: snapshot({ buffered: [[40, 80]], time: 50 }),
    },
    expected: {},
  },
  {
    action: {
      type: "buffer_full",
      current: snapshot({ buffered: [[40, 80]], time: 50 }),
    },
    expected: {},
  },
]

const cases = [
  ...[1, 2].map((frames): Case => {
    const end = BUFFER_HIGH + frames / 30
    return {
      name: `native 30fps end ${end} reaches high water regardless of request rounding`,
      steps: [
        {
          action: { type: "source_opened" },
          expected: {
            control: { type: "request", request: { frontier: 0, position: 0 } },
            seek: 0,
          },
        },
        { action: { type: "seeked", current: snapshot() }, expected: {} },
        {
          action: {
            type: "buffered",
            current: snapshot({ buffered: [[0, end]] }),
          },
          expected: {},
        },
        {
          action: { type: "bytes_received", bytes: new Uint8Array([1]) },
          expected: { control: { type: "pause" } },
        },
        {
          action: {
            type: "progress",
            current: snapshot({ buffered: [[0, end]], time: end - BUFFER_LOW }),
          },
          expected: {},
        },
        {
          action: {
            type: "progress",
            current: snapshot({
              buffered: [[0, end]],
              time: end - BUFFER_LOW + 0.01,
            }),
          },
          expected: {
            control: {
              type: "request",
              request: {
                frontier: Math.round(end * 1_000) / 1_000,
                position: Math.round(end * 1_000) / 1_000,
              },
            },
          },
        },
      ],
    }
  }),
  {
    name: "rounding tolerance does not attach a new frontier to an older range across a real gap",
    position: 60.05,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            type: "request",
            request: { frontier: 60.05, position: 60.05 },
          },
          seek: 60.05,
        },
      },
      {
        action: {
          type: "seeked",
          current: snapshot({
            buffered: [
              [0, 60],
              [60.1, 140.1],
            ],
            time: 60.11,
          }),
        },
        expected: { control: { type: "pause" } },
      },
    ],
  },
  {
    name: "quota holds acquisition through buffered seeks until half the playable buffer is consumed",
    position: 40,
    steps: [
      ...quota_steps,
      {
        action: {
          type: "progress",
          current: snapshot({ buffered: [[40, 80]], time: 50 }),
        },
        expected: {},
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[40, 80]], time: 50 }),
        },
        expected: { persist: 50 },
      },
      {
        action: {
          type: "seeking",
          current: snapshot({ buffered: [[40, 80]], time: 55, seeking: true }),
        },
        expected: { persist: 55 },
      },
      {
        action: {
          type: "seeked",
          current: snapshot({ buffered: [[40, 80]], time: 55 }),
        },
        expected: {},
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[40, 80]], time: 65 }),
        },
        expected: { persist: 65 },
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[40, 80]], time: 65.001 }),
        },
        expected: {
          control: { type: "request", request: { frontier: 80, position: 80 } },
          persist: 65.001,
        },
      },
      {
        action: {
          type: "waiting",
          current: snapshot({ buffered: [[40, 80]], time: 65.001 }),
        },
        expected: {},
      },
    ],
  },
  {
    name: "an unbuffered seek overrides quota hysteresis without forgetting the learned capacity",
    position: 40,
    steps: [
      ...quota_steps,
      {
        action: {
          type: "seeking",
          current: snapshot({ buffered: [[40, 80]], time: 10, seeking: true }),
        },
        expected: {
          control: { type: "request", request: { frontier: 10, position: 10 } },
          persist: 10,
        },
      },
      {
        action: { type: "seeked", current: snapshot({ time: 10 }) },
        expected: {},
      },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[10, 30]], time: 10 }),
        },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          type: "progress",
          current: snapshot({ buffered: [[10, 30]], time: 10 }),
        },
        expected: {},
      },
    ],
  },
  {
    name: "a new source resets the low-water threshold learned from quota",
    position: 40,
    steps: [
      ...quota_steps,
      {
        action: { type: "source_closed", position: 50, paused: true },
        expected: { control: { type: "rebuild" } },
      },
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 50, position: 50 } },
          seek: 50,
        },
      },
      {
        action: { type: "seeked", current: snapshot({ time: 50 }) },
        expected: {},
      },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[50, 70]], time: 50 }),
        },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          type: "progress",
          current: snapshot({ buffered: [[50, 70]], time: 50 }),
        },
        expected: {
          control: { type: "request", request: { frontier: 70, position: 70 } },
        },
      },
    ],
  },
  ...[false, true].map((paused): Case => ({
    name: `source replacement ${paused ? "preserves a user pause" : "resumes once after its seek settles"}`,
    position: 40,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 40, position: 40 } },
          seek: 40,
        },
      },
      {
        action: { type: "canplay", current: snapshot({ time: 40, paused }) },
        expected: {},
      },
      {
        action: { type: "source_closed", position: 40, paused },
        expected: { control: { type: "rebuild" } },
      },
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 40, position: 40 } },
          seek: 40,
        },
      },
      {
        action: {
          type: "loadedmetadata",
          current: snapshot({ metadata: false }),
        },
        expected: {},
      },
      {
        action: { type: "canplay", current: snapshot() },
        expected: { seek: 40 },
      },
      {
        action: { type: "seeked", current: snapshot({ time: 40 }) },
        expected: paused ? {} : { play: true },
      },
      {
        action: { type: "canplay", current: snapshot({ time: 40 }) },
        expected: {},
      },
    ],
  })),
  {
    name: "play intent survives a replacement that fails before it can resume",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      {
        action: { type: "seeked", current: snapshot({ paused: false }) },
        expected: {},
      },
      {
        action: { type: "source_closed", position: 0, paused: false },
        expected: { control: { type: "rebuild" } },
      },
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      {
        action: { type: "source_closed", position: 0, paused: true },
        expected: { control: { type: "rebuild" } },
      },
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      {
        action: { type: "canplay", current: snapshot() },
        expected: { play: true },
      },
      { action: { type: "timeupdate", current: snapshot() }, expected: {} },
    ],
  },
  {
    name: "a failed complete tail still applies an unacknowledged startup seek",
    position: 141,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            type: "request",
            request: { frontier: 141, position: 141 },
          },
          seek: 141,
        },
      },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[141, 200]] }),
        },
        expected: {},
      },
      {
        action: { type: "request_failed", error: failure },
        expected: { error: failure },
      },
      {
        action: {
          type: "request_retry",
          current: snapshot({ buffered: [[141, 200]] }),
        },
        expected: { buffer: { type: "end" }, seek: 141 },
      },
    ],
  },
  ...[200, 199.98, 199].map((end): Case => ({
    name: `a delayed retry at frontier ${end} respects completion without bypassing backoff`,
    position: 200 - BUFFER_HIGH + 1,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            type: "request",
            request: {
              frontier: 200 - BUFFER_HIGH + 1,
              position: 200 - BUFFER_HIGH + 1,
            },
          },
          seek: 200 - BUFFER_HIGH + 1,
        },
      },
      {
        action: {
          type: "seeked",
          current: snapshot({ time: 200 - BUFFER_HIGH + 1 }),
        },
        expected: {},
      },
      {
        action: {
          type: "buffered",
          current: snapshot({
            buffered: [[200 - BUFFER_HIGH + 1, end]],
            time: 200 - BUFFER_HIGH + 1,
          }),
        },
        expected: {},
      },
      {
        action: { type: "request_failed", error: failure },
        expected: { error: failure },
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({
            buffered: [[200 - BUFFER_HIGH + 1, end]],
            time: end - BUFFER_LOW + 1,
          }),
        },
        expected: { persist: end - BUFFER_LOW + 1 },
      },
      {
        action: {
          type: "request_retry",
          current: snapshot({
            buffered: [[200 - BUFFER_HIGH + 1, end]],
            time: end - BUFFER_LOW + 1,
          }),
        },
        expected:
          end >= 199.9
            ? { buffer: { type: "end" } }
            : {
                control: {
                  type: "request",
                  request: { frontier: end, position: end },
                },
              },
      },
    ],
  })),
  {
    name: "a retry with sufficient retained data waits for low water before continuing",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, BUFFER_LOW]] }),
        },
        expected: {},
      },
      {
        action: { type: "request_failed", error: failure },
        expected: { error: failure },
      },
      {
        action: {
          type: "request_retry",
          current: snapshot({ buffered: [[0, BUFFER_LOW]] }),
        },
        expected: { control: { type: "pause" } },
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[0, BUFFER_LOW]], time: 1 }),
        },
        expected: {
          control: {
            type: "request",
            request: { frontier: BUFFER_LOW, position: BUFFER_LOW },
          },
          persist: 1,
        },
      },
    ],
  },
  ...(["progress", "ended"] as const).map((type): Case => ({
    name: `audit: ${type} after short EOF requests new content at the acknowledged frontier`,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, BUFFER_LOW - 1]] }),
        },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          type,
          current: snapshot({
            buffered: [[0, BUFFER_LOW - 1]],
            time: type === "ended" ? BUFFER_LOW - 1 : 0,
          }),
        },
        expected: {
          control: {
            type: "request",
            request: { frontier: BUFFER_LOW - 1, position: BUFFER_LOW - 1 },
          },
          ...(type === "ended" ? { persist: BUFFER_LOW - 1 } : {}),
        },
      },
    ],
  })),
  ...[BUFFER_LOW - 1, BUFFER_HIGH].map((end): Case => ({
    name: `a buffered seek away from another request resumes its own range ending at ${end}`,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, end]] }),
        },
        expected: {},
      },
      {
        action: {
          type: "seeking",
          current: snapshot({ buffered: [[0, end]], time: 120, seeking: true }),
        },
        expected: {
          control: {
            type: "request",
            request: { frontier: 120, position: 120 },
          },
          persist: 120,
        },
      },
      {
        action: {
          type: "seeking",
          current: snapshot({ buffered: [[0, end]], time: 10, seeking: true }),
        },
        expected: {
          control:
            end === BUFFER_HIGH
              ? { type: "pause" }
              : { type: "request", request: { frontier: end, position: end } },
          persist: 10,
        },
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({
            buffered: [[0, end]],
            time: Math.max(10, end - BUFFER_LOW + 1),
          }),
        },
        expected: {
          ...(end === BUFFER_HIGH
            ? {
                control: {
                  type: "request",
                  request: { frontier: end, position: end },
                } as const,
              }
            : {}),
          persist: Math.max(10, end - BUFFER_LOW + 1),
        },
      },
      {
        action: {
          type: "seeking",
          current: snapshot({ buffered: [[0, end]], time: end, seeking: true }),
        },
        expected: { persist: end },
      },
    ],
  })),
  ...[199.98, 199, BUFFER_LOW].map((end): Case => ({
    name: `EOF at ${end} of 200 only stops acquisition within terminal tolerance`,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, end]] }),
        },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          type: "ended",
          current: snapshot({ buffered: [[0, end]], time: end }),
        },
        expected: {
          ...(end === 199.98
            ? {}
            : {
                control: {
                  type: "request",
                  request: {
                    frontier: end,
                    position: end,
                  },
                } as const,
              }),
          persist: end === 199.98 ? 0 : end,
        },
      },
    ],
  })),
  {
    name: "a pending startup seek survives observations before recovery",
    position: 40,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 40, position: 40 } },
          seek: 40,
        },
      },
      {
        action: { type: "timeupdate", current: snapshot() },
        expected: { seek: 40 },
      },
      {
        action: { type: "source_closed", position: 0, paused: true },
        expected: { control: { type: "rebuild" } },
      },
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 40, position: 40 } },
          seek: 40,
        },
      },
    ],
  },
  {
    name: "complete buffered media stays idle through tail playback and can be replayed",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, 200]] }),
        },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[0, 200]], time: 180 }),
        },
        expected: { persist: 180 },
      },
      {
        action: {
          type: "ended",
          current: snapshot({ buffered: [[0, 200]], time: 200 }),
        },
        expected: { persist: 0 },
      },
      {
        action: {
          type: "progress",
          current: snapshot({ buffered: [[0, 200]], time: 200 }),
        },
        expected: {},
      },
      {
        action: {
          type: "seeking",
          current: snapshot({ seeking: true, time: 10 }),
        },
        expected: {
          control: { type: "request", request: { frontier: 10, position: 10 } },
          persist: 10,
        },
      },
    ],
  },
  ...[
    BUFFER_HIGH - BUFFER_LOW,
    BUFFER_HIGH - BUFFER_LOW + 0.001,
    RESUME_AT,
    BUFFER_HIGH,
  ].map((time): Case => ({
    name: `acknowledged backpressure at time ${time} keeps state and request effects aligned`,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: { type: "request", request: { frontier: 0, position: 0 } },
          seek: 0,
        },
      },
      { action: { type: "seeked", current: snapshot() }, expected: {} },
      {
        action: {
          type: "buffered",
          current: snapshot({ buffered: [[0, BUFFER_HIGH]] }),
        },
        expected: {},
      },
      {
        action: {
          type: "timeupdate",
          current: snapshot({ buffered: [[0, BUFFER_HIGH]], time }),
        },
        expected: {
          control:
            time === BUFFER_HIGH - BUFFER_LOW
              ? { type: "pause" }
              : {
                  type: "request",
                  request: { frontier: BUFFER_HIGH, position: BUFFER_HIGH },
                },
          ...(time < BUFFER_HIGH ? { persist: time } : {}),
        },
      },
      {
        action: {
          type: "waiting",
          current: snapshot({ buffered: [[0, BUFFER_HIGH]], time }),
        },
        expected: {},
      },
    ],
  })),
  {
    name: "source opening describes startup",
    position: 40,
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            request: { frontier: 40, position: 40 },
            type: "request",
          },
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
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          current: snapshot({ buffered: [[0, BUFFER_LOW]] }),
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
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: {
          current: snapshot({ buffered: [[0, BUFFER_LOW - 1]] }),
          type: "progress",
        },
        expected: {
          control: {
            request: { frontier: BUFFER_LOW - 1, position: BUFFER_LOW - 1 },
            type: "request",
          },
        },
      },
    ],
  },
  {
    name: "low water resumes at an advanced buffered frontier",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
      },
      {
        action: {
          current: snapshot({ buffered: [[0, BUFFER_HIGH]] }),
          type: "progress",
        },
        expected: { control: { type: "pause" } },
      },
      {
        action: {
          current: snapshot({ buffered: [[0, BUFFER_HIGH]], time: RESUME_AT }),
          type: "timeupdate",
        },
        expected: {
          control: {
            request: { frontier: BUFFER_HIGH, position: BUFFER_HIGH },
            type: "request",
          },
          persist: RESUME_AT,
        },
      },
    ],
  },
  {
    name: "an external unbuffered seek retargets acquisition",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
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
          control: {
            request: { frontier: 110, position: 110 },
            type: "request",
          },
          persist: 110,
        },
      },
    ],
  },
  {
    name: "a failed request reports and retries from its frontier",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
      },
      {
        action: { error: failure, type: "request_failed" },
        expected: { error: failure },
      },
      {
        action: { type: "request_retry", current: snapshot() },
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
        },
      },
    ],
  },
  {
    name: "a batch folds independent effects",
    steps: [
      {
        action: { type: "source_opened" },
        expected: {
          control: {
            request: { frontier: 0, position: 0 },
            type: "request",
          },
          seek: 0,
        },
      },
      {
        action: { current: snapshot(), type: "seeked" },
        expected: {},
      },
      {
        action: { type: "request_finished" },
        expected: { buffer: { type: "end" } },
      },
      {
        action: [
          {
            current: snapshot({ buffered: [[0, 20]], time: 10 }),
            type: "timeupdate",
          },
          {
            current: snapshot({ buffered: [[0, 20]], time: 10 }),
            type: "progress",
          },
        ],
        expected: {
          control: {
            request: { frontier: 20, position: 20 },
            type: "request",
          },
          persist: 10,
        },
      },
    ],
  },
] as const satisfies readonly Case[]

const shuffled: readonly Case[] = cases
  .map((testCase) => ({ order: randomUUID(), testCase }))
  .sort((left, right) => left.order.localeCompare(right.order))
  .map(({ testCase }) => testCase)

await Promise.all([
  ...(
    [
      ["play", "canplay"],
      ["canplay", "play"],
    ] as const
  ).map((types) =>
    nodeTest(
      `native play owns resumption for ${types.join("/")}`,
      options,
      () => {
        const dispatch = playback_transitions(0)
        dispatch({ type: "source_opened" })
        dispatch({ type: "source_closed", paused: false, position: 0 })
        dispatch({ type: "source_opened" })
        const effects = dispatch(
          types.map((type) => ({ type, current: snapshot() })),
        )
        equal(effects.play, false)
        equal(
          dispatch({ type: "canplay", current: snapshot() }).play,
          undefined,
        )
      },
    ),
  ),
  ...[false, true].flatMap((paused) =>
    (
      [
        ["error", "timeupdate"],
        ["timeupdate", "error"],
      ] as const
    ).map((types) =>
      nodeTest(
        `rebuild defers play for ${types.join("/")} with paused=${paused}`,
        options,
        () => {
          const dispatch = playback_transitions(0)
          dispatch({ type: "source_opened" })
          dispatch({ type: "source_closed", position: 0, paused })
          dispatch({ type: "source_opened" })
          const current = snapshot({
            paused,
            error: { code: 3, message: "decode failed" } as MediaError,
          })
          const effects = dispatch(types.map((type) => ({ type, current })))
          deepEqual(effects.control, { type: "rebuild" })
          equal(effects.play, undefined)
          dispatch({ type: "source_opened" })
          equal(
            dispatch({ type: "canplay", current: snapshot() }).play,
            paused ? undefined : true,
          )
          equal(
            dispatch({ type: "canplay", current: snapshot() }).play,
            undefined,
          )
        },
      ),
    ),
  ),
  ...shuffled.map(({ name, position = 0, steps }) =>
    nodeTest(name, options, () => {
      const dispatch = playback_transitions(position)

      for (const { action, expected } of steps) {
        deepEqual(dispatch(action), expected)
      }
    }),
  ),
  ...([[], [[20, 40]]] as const).map((buffered) =>
    nodeTest(
      `quota with no playable future in ${JSON.stringify(buffered)} requests a retry`,
      options,
      () => {
        const dispatch = playback_transitions(40)
        dispatch({ type: "source_opened" })
        const effects = dispatch({
          type: "buffer_full",
          current: snapshot({
            buffered,
            time: 40,
          }),
        })
        equal(effects.error, undefined)
        deepEqual(effects.control, { type: "retry" })
        equal(effects.buffer, undefined)
      },
    ),
  ),
])

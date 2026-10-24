import { ok } from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test, { type TestContext } from "node:test"
import { setImmediate } from "node:timers/promises"
import { Script } from "node:vm"

export type Range = readonly [start: number, end: number]
export type TestCase = Readonly<{
  name: string
  run: (context: TestContext) => Promise<void>
}>

export class EventTarget extends globalThis.EventTarget {
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options)
    if (
      typeof options === "object" &&
      options.signal &&
      !options.signal.aborted
    ) {
      // Node can garbage-collect earlier signal-removal callbacks on one target.
      options.signal.addEventListener(
        "abort",
        () => this.removeEventListener(type, listener, options),
        { once: true },
      )
    }
  }
}

export const subtitle_fixture = () => {
  const cancelled: (() => void)[] = []
  const requests: string[] = []
  const subtitle = Object.assign(new EventTarget(), {
    dataset: { src: "/subtitle" },
    readyState: 0,
    NONE: 0,
    LOADING: 1,
    LOADED: 2,
    ERROR: 3,
    track: { mode: "showing" },
    dispatchEvent: (event: Event): boolean => {
      if (event.type === "load") {
        subtitle.readyState = subtitle.LOADED
      }
      if (event.type === "error") {
        subtitle.readyState = subtitle.ERROR
      }
      return EventTarget.prototype.dispatchEvent.call(subtitle, event)
    },
    removeAttribute: (name: string) => {
      if (name === "src") {
        source = ""
        subtitle.readyState = 0
      }
    },
  })
  let source = ""
  const finish = (type: "load" | "error"): void => {
    subtitle.dispatchEvent(new Event(type))
  }
  Object.defineProperty(subtitle, "src", {
    get: () => source,
    set: (value: string) => {
      if (
        subtitle.readyState === subtitle.LOADING &&
        value !== requests.at(-1)
      ) {
        // HTML queues an error when changing the URL of a loading text track.
        // https://html.spec.whatwg.org/multipage/media.html#sourcing-out-of-band-text-tracks
        cancelled.push(() => finish("error"))
      }
      requests.push(value)
      source = value
      subtitle.readyState = subtitle.LOADING
    },
  })
  return { cancelled, finish, requests, subtitle }
}

export class Ranges implements TimeRanges {
  readonly values: Range[] = []

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

export const timeRanges = (...ranges: Range[]): Ranges => {
  const result = new Ranges()
  result.values.push(...ranges)
  return result
}

export const eventually = async (predicate: () => boolean): Promise<void> => {
  const deadline = performance.now() + 1_000
  while (performance.now() < deadline) {
    if (predicate()) {
      return
    }
    await setImmediate()
  }
  ok(predicate(), "condition did not become true")
}

export const run_cases = async (cases: readonly TestCase[]): Promise<void> => {
  const shuffled = cases
    .map((entry) => ({ entry, order: randomUUID() }))
    .sort((left, right) => left.order.localeCompare(right.order))
    .map(({ entry }) => entry)
  await Promise.all(
    shuffled.map(({ name, run }) =>
      test(name, { concurrency: true, timeout: 2_000 }, run),
    ),
  )
}

export const player_script = async (
  modules: readonly string[],
  expose: string,
): Promise<Script> => {
  const files = await Promise.all(
    modules.map((name) => readFile(new URL(name, import.meta.url), "utf8")),
  )
  let importing = false
  const source = files
    .join("\n")
    .split("\n")
    .filter((line) => {
      if (line.startsWith("import ")) {
        importing = !line.includes(" from ")
        return false
      }
      if (!importing) {
        return true
      }
      importing = !line.includes(" from ")
      return false
    })
    .join("\n")
    .replace(/^export /gmu, "")
    .replace(/^void main\(playback\)\.catch\(console\.error\)$/gmu, "")
  return new Script(
    stripTypeScriptTypes(`${source}\n${expose}`, { mode: "strip" }),
  )
}

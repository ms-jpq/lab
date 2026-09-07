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
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
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

import { deepEqual, ok } from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { env } from "node:process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { firefox } from "playwright"

const run = promisify(execFile)
const directory = dirname(fileURLToPath(import.meta.url))
const root = resolve(directory, "../../../../../../..")
const temporary = await mkdtemp(join(tmpdir(), "media-firefox-"))
const ffmpeg = env["FFMPEG"] ?? "ffmpeg"
const fixture = join(temporary, "dogs.mkv")
const requests: number[] = []
const errors: string[] = []

const render = async (
  name: string,
  values: Readonly<Record<string, string>>,
): Promise<string> =>
  (await readFile(join(directory, "../templates", name), "utf8"))
    .replace(/(?:<!--\s*|\/\*\s*)(\$\{\w+\})(?:\s*-->|\s*\*\/)/g, "$1")
    .replace(/\$\{(\w+)\}/g, (_, key: string) => values[key] ?? "")

try {
  await run(join(root, "node_modules/.bin/tsc"), [
    "-p",
    directory,
    "--outDir",
    join(temporary, "build"),
  ])
  await run(ffmpeg, [
    "-v",
    "error",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=64x48:rate=12",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    "400",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    fixture,
  ])
  const video = await render("player-video.html", {
    duration: "400",
    mse_type: "video/mp4; codecs=&quot;avc1.640033,mp4a.40.2&quot;",
    stream_url: "/stream",
    track: "",
  })
  const html = await render("player.html", {
    title: "Dogs",
    style: "",
    player: video,
    time: "0",
    profile_options: "",
    audio_options: "",
    script: "/index.js",
  })
  const server = createServer((request, response): void => {
    const serve = async (): Promise<void> => {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (url.pathname === "/stream") {
        const position = url.searchParams.get("t") ?? "0"
        requests.push(Number(position))
        response.writeHead(200, { "Content-Type": "video/mp4" })
        const encoder = spawn(ffmpeg, [
          "-v",
          "error",
          "-nostdin",
          "-ss",
          position,
          "-copyts",
          "-i",
          fixture,
          "-ss",
          position,
          "-map",
          "0:a",
          "-c:a",
          "aac",
          "-ac",
          "2",
          "-ar",
          "44100",
          "-map",
          "0:v",
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-bf",
          "0",
          "-g",
          url.searchParams.get("gop") ?? "1440",
          "-r",
          "12",
          "-profile:v",
          "high",
          "-movflags",
          "frag_keyframe+empty_moov+default_base_moof",
          "-flush_packets",
          "1",
          "-frag_duration",
          "1000000",
          "-f",
          "mp4",
          "pipe:1",
        ])
        encoder.stdout.pipe(response)
        encoder.stderr.on("data", (data: Buffer): void => {
          errors.push(String(data))
        })
        encoder.on("error", (error: Error): void => {
          errors.push(String(error))
          response.destroy(error)
        })
        response.on("close", (): void => {
          encoder.kill("SIGKILL")
        })
      } else if (url.pathname.endsWith(".js")) {
        response.writeHead(200, { "Content-Type": "text/javascript" })
        response.end(
          await readFile(
            join(
              temporary,
              "build/layers/media/usr/local/opt/media/player",
              url.pathname.slice(1),
            ),
          ),
        )
      } else {
        response.writeHead(200, { "Content-Type": "text/html" })
        response.end(
          html.replace(
            'data-src="/stream"',
            `data-src="/stream?gop=${url.searchParams.get("gop") ?? "1440"}"`,
          ),
        )
      }
    }
    void serve().catch((error: unknown): void => {
      errors.push(String(error))
      response.destroy()
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  try {
    for (const { name, gop, quota } of [
      { name: "long GOP", gop: 1440, quota: 100 * 1024 * 1024 },
      { name: "native eviction", gop: 24, quota: 262144 },
    ]) {
      const browser = await firefox.launch({
        headless: true,
        firefoxUserPrefs: {
          "media.autoplay.default": 0,
          "media.mediasource.eviction_threshold.video": quota,
          "media.mediasource.eviction_threshold.audio": quota,
        },
      })
      try {
        const page = await browser.newPage()
        await page.addInitScript((): void => {
          const original = SourceBuffer.prototype.appendBuffer
          let quotaErrors = 0
          Object.defineProperty(window, "quotaErrors", {
            get: (): number => quotaErrors,
          })
          SourceBuffer.prototype.appendBuffer = function (
            this: SourceBuffer,
            data: BufferSource,
          ): void {
            try {
              original.call(this, data)
            } catch (error) {
              if (
                error instanceof DOMException &&
                error.name === "QuotaExceededError"
              )
                quotaErrors += 1
              throw error
            }
          }
        })
        page.on("pageerror", (error: Error): void => {
          errors.push(String(error))
        })
        try {
          const address = server.address()
          if (!address || typeof address === "string")
            throw new Error("Missing HTTP address")
          await page.goto(`http://127.0.0.1:${address.port}/?t=0&gop=${gop}`)
          await page
            .locator("video")
            .evaluate(async (video: HTMLVideoElement): Promise<void> => {
              video.defaultPlaybackRate = 8
              video.playbackRate = 8
              await video.play()
            })
          // A 120-second GOP makes remove(currentTime - 30) delete the current GOP.
          for (const target of [0, 250.125, 40.033]) {
            if (target)
              await page
                .locator("video")
                .evaluate((video: HTMLVideoElement, time: number): void => {
                  video.currentTime = time
                }, target)
            for (const advance of [35, 65, 95]) {
              await page.waitForFunction(
                (position: number): boolean => {
                  const video = document.querySelector("video")
                  return (
                    !!video &&
                    video.currentTime > position &&
                    !video.paused &&
                    !video.seeking
                  )
                },
                target + advance,
                { timeout: 20_000 },
              )
            }
          }
          deepEqual(errors, [])
          if (quota === 262144)
            ok(
              await page.evaluate(
                (): boolean => Reflect.get(window, "quotaErrors") > 0,
              ),
              "native eviction profile must reach quota",
            )
          console.log(
            `Firefox: ${name}, request restarts, and disjoint seeks passed`,
          )
        } catch (error) {
          console.error(
            JSON.stringify(
              {
                profile: name,
                requests,
                errors,
                state: await page
                  .locator("video")
                  .evaluate((video: HTMLVideoElement) => ({
                    time: video.currentTime,
                    ready: video.readyState,
                    seeking: video.seeking,
                    paused: video.paused,
                    buffered: Array.from(
                      { length: video.buffered.length },
                      (_, index) => [
                        video.buffered.start(index),
                        video.buffered.end(index),
                      ],
                    ),
                  })),
              },
              undefined,
              2,
            ),
          )
          throw error
        }
      } finally {
        await browser.close()
      }
    }
  } finally {
    server.closeAllConnections()
    server.close()
    await once(server, "close")
  }
} finally {
  await rm(temporary, { recursive: true, force: true })
}

/**
 * The media write paths added 2026-11-25, exercised on Telegram's test data
 * centers (the only place a write may run with real TDLib):
 *
 *   cd apps\desktop
 *   $env:TDLIB_PROXY='http://127.0.0.1:7892'
 *   $env:WEGRAM_TEST_VIDEO='D:\vibe-coding\WechatGram\.cache\testdc-probe.mp4'
 *   pnpm tdlib:test-dc:media
 *
 * A single video message (inputMessageVideo), a mixed photo + video album
 * (sendMessageAlbum) and 取消上传 (deleteMessages on a still-pending row).
 *
 * The repo ships no video, and TDLib re-encodes nothing: the fixture has to be a
 * real H.264 MP4. Download a public sample once (through the same proxy):
 *
 *   Invoke-WebRequest -Proxy http://127.0.0.1:7892 `
 *     -Uri https://download.samplelib.com/mp4/sample-5s.mp4 `
 *     -OutFile .cache\testdc-probe.mp4
 *
 * Without WEGRAM_TEST_VIDEO the script looks for .cache/testdc-probe.mp4.
 *
 * Outcomes, as in tdlib-test-dc-writes.ts:
 *   PASS     the server stored the message and the metadata read back;
 *   PARTIAL  the call path ran but the fixture could not prove the full round trip;
 *   SKIP     the API refuses on this target;
 *   FAIL     the code's fault — a shape or mapping bug.
 *
 * WEGRAM_TEST_KEEP=1 leaves the probe rows behind; otherwise they are deleted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { probeVideoMeta } from '../src/main/media/video-meta'
import {
  authorizeTestDc,
  createTestDcAdapter,
  deleteSettled,
  errorText,
  loadTestDcEnv,
  printTestDcBanner,
  settledMessage,
  settledMessages,
  sleep,
  waitForGone,
  writeProbePng,
  withTimeout,
} from './testdc/harness'

const VIDEO_PATH = resolve(
  process.env['WEGRAM_TEST_VIDEO']?.trim() || '../../.cache/testdc-probe.mp4',
)
if (!existsSync(VIDEO_PATH)) {
  console.error(`Missing video fixture: ${VIDEO_PATH}`)
  console.error("Pass WEGRAM_TEST_VIDEO=<a real H.264 MP4>; see this file's header.")
  process.exit(2)
}

const env = loadTestDcEnv()
printTestDcBanner(env)

const adapter = createTestDcAdapter(env)
const guard = setTimeout(() => {
  console.error('\n[FAIL] timed out after 300s')
  process.exit(1)
}, 300_000)

type Outcome = 'PASS' | 'PARTIAL' | 'SKIP' | 'FAIL'

interface Result {
  name: string
  outcome: Outcome
  detail: string
}

class Limited extends Error {
  readonly partial: boolean

  constructor(detail: string, partial: boolean) {
    super(detail)
    this.partial = partial
  }
}

const results: Result[] = []

function record(name: string, outcome: Outcome, detail: string): void {
  results.push({ name, outcome, detail })
  console.log(`[${outcome}] ${name.padEnd(14)}: ${detail}`)
}

function limited(detail: string, partial = false): never {
  throw new Limited(detail, partial)
}

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    record(name, 'PASS', await run())
  } catch (error) {
    if (error instanceof Limited) record(name, error.partial ? 'PARTIAL' : 'SKIP', error.message)
    else record(name, 'FAIL', errorText(error))
  }
}

/**
 * A copy of the fixture with a trailing `free` box, so the upload is still running
 * when 取消上传 is pressed. ISO BMFF ignores an unknown top-level box; the video
 * decoder does too, and our own metadata probe skips it.
 */
function paddedCopy(sourcePath: string, megabytes: number): string {
  const source = readFileSync(sourcePath)
  const payload = Math.round(megabytes * 1024 * 1024)
  const free = Buffer.alloc(8)
  free.writeUInt32BE(8 + payload, 0)
  free.write('free', 4, 'ascii')
  const dir = join(tmpdir(), 'wegram-test-dc')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'probe-padded.mp4')
  writeFileSync(file, Buffer.concat([source, free, Buffer.alloc(payload)]))
  return file
}

function rawContent(raw: unknown): object {
  if (!raw || typeof raw !== 'object') throw new Error('getMessage answered no object')
  const content = Reflect.get(raw, 'content')
  if (!content || typeof content !== 'object') throw new Error('the message has no content')
  return content
}

void main()

async function main(): Promise<void> {
  const probeIds: number[] = []
  try {
    await adapter.start()
    if ((await authorizeTestDc(adapter, env)) !== 'ready') {
      console.log(
        '\n[WAIT] the code was requested — rerun with WEGRAM_TEST_CODE=<the code Telegram sent>',
      )
      return
    }
    console.log('[PASS] authorized on the test data center')

    const me = await withTimeout(adapter.me(), 20_000, 'getMe')
    const chats = await adapter.listChats({ limit: 50, offset: 0 })
    const self = chats.find((chat) => chat.userId === me.id)
    if (!self) throw new Error('Saved Messages is missing from the chat list')

    console.log(`  me         : ${me.id}`)
    console.log(`  self chat  : ${self.id}`)
    console.log(`  video      : ${VIDEO_PATH}`)
    console.log('')

    // ---- probeVideoMeta on the real fixture ---------------------------------
    await check('video-probe', async () => {
      const meta = await probeVideoMeta(VIDEO_PATH)
      if (!meta) throw new Error('the MP4 parser did not recognise the fixture')
      if (meta.width <= 0 || meta.height <= 0)
        throw new Error(`bad box ${meta.width}x${meta.height}`)
      if (meta.duration <= 0) throw new Error('the fixture has no duration')
      return `${meta.width}x${meta.height}, ${meta.duration}s`
    })

    // ---- one video message (inputMessageVideo) ------------------------------
    await check('video-send', async () => {
      const marker = `WeGram video probe ${Date.now()}`
      const sent = await adapter.sendMedia({
        chatId: self.id,
        filePath: VIDEO_PATH,
        kind: 'video',
        caption: marker,
      })
      if (sent.message.kind !== 'video') {
        throw new Error(`sendMedia mapped kind ${sent.message.kind}, expected video`)
      }
      const settled = await settledMessage(
        adapter,
        self.id,
        // `getMessage` only accepts a settled id: while the upload runs the row
        // still carries a temporary one, and the raw check would answer Not Found.
        (message) =>
          message.kind === 'video' &&
          message.text.includes(marker) &&
          message.sendingState === undefined,
        'the sent video',
        60_000,
      )
      probeIds.push(settled.id)
      const raw = await adapter.rawInvoke({
        _: 'getMessage',
        chat_id: self.id,
        message_id: settled.id,
      })
      const content = rawContent(raw)
      const contentType = Reflect.get(content, '_')
      if (contentType !== 'messageVideo') {
        throw new Error(`TDLib stored ${String(contentType)}, expected messageVideo`)
      }
      const video = Reflect.get(content, 'video')
      if (!video || typeof video !== 'object')
        throw new Error('messageVideo carries no video object')
      const duration = Number(Reflect.get(video, 'duration'))
      const width = Number(Reflect.get(video, 'width'))
      const height = Number(Reflect.get(video, 'height'))
      if (!(duration > 0) || !(width > 0) || !(height > 0)) {
        throw new Error(`server metadata is empty: ${duration}s ${width}x${height}`)
      }
      if (settled.media?.width !== width || settled.media?.height !== height) {
        throw new Error(
          `DTO ${String(settled.media?.width)}x${String(settled.media?.height)} != server ${width}x${height}`,
        )
      }
      return `messageVideo ${width}x${height}, ${duration}s (id ${settled.id})`
    })

    // ---- mixed photo + video album (sendMessageAlbum) -----------------------
    await check('mixed-album', async () => {
      const marker = `WeGram album probe ${Date.now()}`
      const photo = writeProbePng('probe-album')
      const album = await adapter.sendAlbum({
        chatId: self.id,
        items: [
          { filePath: photo, kind: 'photo', caption: marker },
          { filePath: VIDEO_PATH, kind: 'video' },
        ],
      })
      if (album.messages.length !== 2) {
        throw new Error(`sendAlbum answered ${album.messages.length} rows, expected 2`)
      }
      const albumId = album.messages[0]?.albumId
      if (!albumId)
        limited('the send answer carried no album id; the rows cannot be found again', true)
      const rows = await settledMessages(
        adapter,
        self.id,
        (message) => message.albumId === albumId && message.sendingState === undefined,
        2,
        'the mixed album',
        60_000,
      )
      for (const row of rows) probeIds.push(row.id)
      const kinds = rows.map((row) => row.kind).sort()
      if (kinds.join(',') !== 'photo,video') {
        throw new Error(`album kinds are ${kinds.join(',')}, expected photo,video`)
      }
      const contents: string[] = []
      for (const row of rows) {
        const raw = await adapter.rawInvoke({
          _: 'getMessage',
          chat_id: self.id,
          message_id: row.id,
        })
        contents.push(String(Reflect.get(rawContent(raw), '_')))
        if (String(raw.media_album_id) !== albumId) {
          throw new Error(`row ${row.id} lost its album id`)
        }
      }
      if (!contents.includes('messagePhoto') || !contents.includes('messageVideo')) {
        throw new Error(`album contents are ${contents.join(', ')}`)
      }
      return `${rows.length} rows share album ${albumId}: ${contents.join(' + ')}`
    })

    // ---- a video the probe cannot measure: the batch goes out separately ----
    await check('album-fallback', async () => {
      const marker = `WeGram fallback probe ${Date.now()}`
      const photo = writeProbePng('probe-fallback-photo')
      // A PNG sent as kind 'video': probeVideoMeta cannot read it, so the album
      // action must notice and send both files as separate messages instead of
      // leaving a document inside a group the transcript cannot fold.
      const fakeVideo = writeProbePng('probe-fallback-video')
      const album = await adapter.sendAlbum({
        chatId: self.id,
        items: [
          { filePath: photo, kind: 'photo', caption: `${marker} photo` },
          { filePath: fakeVideo, kind: 'video', caption: `${marker} doc` },
        ],
      })
      if (album.messages.length !== 2) {
        throw new Error(`the fallback answered ${album.messages.length} rows, expected 2`)
      }
      const rows = await settledMessages(
        adapter,
        self.id,
        (message) => message.text.includes(marker) && message.sendingState === undefined,
        2,
        'the fallback rows',
        60_000,
      )
      for (const row of rows) probeIds.push(row.id)
      if (rows.some((row) => row.albumId !== undefined)) {
        throw new Error('the fallback still carried an album id')
      }
      const kinds = rows.map((row) => row.kind).sort()
      if (kinds.join(',') !== 'file,photo') {
        throw new Error(`fallback kinds are ${kinds.join(',')}, expected file,photo`)
      }
      return `2 separate rows (${kinds.join(' + ')}), no album id`
    })

    // ---- 取消上传: a still-pending row is deleted, not delivered ------------
    await check('cancel-upload', async () => {
      const marker = `WeGram cancel probe ${Date.now()}`
      const uploadFile = paddedCopy(VIDEO_PATH, 8)
      const pending = await adapter.sendMedia({
        chatId: self.id,
        filePath: uploadFile,
        kind: 'video',
        caption: marker,
      })
      const wasPending = pending.message.sendingState === 'pending'
      try {
        await adapter.cancelSend({ chatId: self.id, messageId: pending.message.id })
      } catch (error) {
        // The row may have settled between the answer and the delete. Clean it up
        // and report the weaker proof rather than a failure of the cancel path.
        const settled = await settledMessage(
          adapter,
          self.id,
          (message) => message.text.includes(marker) && message.sendingState === undefined,
          'the cancelled row',
          30_000,
        )
        probeIds.push(settled.id)
        limited(`the row settled before cancelSend could remove it (${errorText(error)})`, true)
      }
      await waitForGone(adapter, self.id, [pending.message.id])
      await sleep(2_000)
      const page = await adapter.history({ chatId: self.id, limit: 30 })
      if (page.messages.some((message) => message.text.includes(marker))) {
        throw new Error('the cancelled row is back in history')
      }
      if (!wasPending) {
        limited('the send answered already-settled; the pending branch was not exercised', true)
      }
      return `pending row ${pending.message.id} removed; nothing delivered`
    })

    // ---- cleanup ------------------------------------------------------------
    if (env.cleanup && probeIds.length > 0) {
      const ids = [...new Set(probeIds)]
      try {
        await deleteSettled(adapter, self.id, ids)
        await waitForGone(adapter, self.id, ids)
        console.log(`\n  cleanup    : deleted ${ids.length} probe row(s)`)
      } catch (error) {
        console.error(`\n  cleanup    : FAILED to delete the probe rows: ${errorText(error)}`)
        process.exitCode = 1
      }
    }
  } catch (error) {
    record('setup', 'FAIL', errorText(error))
  } finally {
    clearTimeout(guard)
    summarize()
    await adapter.stop().catch(() => undefined)
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}

function summarize(): void {
  const count = (outcome: Outcome): number =>
    results.filter((row) => row.outcome === outcome).length
  console.log('')
  console.log(
    `${results.length} checks: ${count('PASS')} pass, ${count('PARTIAL')} partial, ${count('SKIP')} skip, ${count('FAIL')} fail`,
  )
  if (count('FAIL') > 0) process.exitCode = 1
}

/**
 * Headless run against Telegram's test data centers — the one place the write
 * paths may be exercised with real TDLib.
 *
 * The test DCs are a separate account space: every `99966XYYYY` number is its
 * own account, no SMS is involved (the code is the data-center id repeated) and
 * nothing there can reach a real chat. Send / edit / delete / upload / 语音消息
 * therefore get proven here, which the mock adapter cannot do for TDLib-specific
 * behaviour and a real session must never do (CLAUDE.md: 真实账号只读).
 *
 *   cd apps\desktop
 *   pnpm tdlib:test-dc
 *
 * Env: TDLIB_PROXY (`socks5://host:port` or `http://host:port`), TDLIB_SESSION_DIR (defaults to
 * `spikes/tdlib/test-data`), WEGRAM_TEST_PHONE (default `+9996620001`),
 * WEGRAM_TEST_CODE (default: the DC id repeated five times, which is what the
 * test servers answer with).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

import type { Message } from '@wegram/protocol'

import { TdlibAdapter } from '../src/main/telegram/tdlib'
import { parseProxyUrl } from '../src/main/proxy-url'
import { isOn, loadDotEnv } from './dotenv'

loadDotEnv(join(process.cwd(), '.env'))

const apiId = Number(process.env['TELEGRAM_API_ID'] ?? 0)
const apiHash = (process.env['TELEGRAM_API_HASH'] ?? '').trim()

if (!apiId || !apiHash) {
  console.error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in apps/desktop/.env')
  process.exit(2)
}

/**
 * Test DC numbers are `+99966<dc>YYYY` and answer with a derived code. A real
 * number also works on the test DCs, but Telegram sends it a real SMS, so it
 * needs an explicit opt-in and the code has to be passed in by hand.
 */
const phone = process.env['WEGRAM_TEST_PHONE']?.trim() || '+9996620001'
const phoneMatch = /^\+99966([1-5])\d{4,}$/.exec(phone)
const isTestNumber = phoneMatch !== null
if (!isTestNumber && !isOn(process.env['WEGRAM_TEST_ALLOW_REAL_PHONE'])) {
  console.error(
    `${phone} is not a test number (+99966<1-5>YYYY); set WEGRAM_TEST_ALLOW_REAL_PHONE=1 if you really mean it`,
  )
  process.exit(2)
}
const dcId = phoneMatch?.[1] ? Number(phoneMatch[1]) : 0
const codeOverride = process.env['WEGRAM_TEST_CODE']?.trim() || null

const sessionDir =
  process.env['TDLIB_SESSION_DIR']?.trim() || resolve('../../spikes/tdlib/test-data')
// The real account's session must never be opened by this script, even with an
// override: TDLib would reject a test-DC client on a production database anyway,
// but a wrong path here would be the one mistake with real consequences.
if (resolve(sessionDir) === resolve('../../spikes/tdlib/data')) {
  console.error('Refusing to run: that is the real-account session directory')
  process.exit(2)
}

const initialProxy = parseProxyUrl(process.env['TDLIB_PROXY'])
/** `WEGRAM_TEST_KEEP=1` leaves the probe messages in place for inspection. */
const cleanup = !isOn(process.env['WEGRAM_TEST_KEEP'])

console.log(`phone      : ${phone}${isTestNumber ? ` (test dc ${dcId})` : ' (real number)'}`)
console.log(
  `code       : ${codeOverride ?? (isTestNumber ? String(dcId).repeat(5) : '(from the SMS, pass WEGRAM_TEST_CODE)')}`,
)
console.log(`session dir: ${sessionDir}`)
console.log(
  `proxy      : ${initialProxy ? `${initialProxy.type} ${initialProxy.host}:${initialProxy.port}` : '(none)'}`,
)
console.log('test dc    : yes — nothing here can reach a real chat')

const adapter = new TdlibAdapter({
  apiId,
  apiHash,
  databaseDirectory: join(sessionDir, 'db'),
  filesDirectory: join(sessionDir, 'files'),
  initialProxy,
  useTestDc: true,
})

const states: string[] = []
adapter.onEvent((event) => {
  if (event.type === 'auth') states.push(`auth:${event.state.kind}`)
  if (event.type === 'connection') states.push(`conn:${event.state}`)
})

const guard = setTimeout(() => {
  console.error(`\n[FAIL] timed out; states seen: ${states.join(' -> ')}`)
  process.exit(1)
}, 180_000)

void main()

async function main(): Promise<void> {
  try {
    await adapter.start()
    const outcome = await authorize()
    if (outcome === 'await-code') {
      console.log('\n[WAIT] the code was requested — rerun with WEGRAM_TEST_CODE=<the code Telegram sent>')
      return
    }
    console.log('[PASS] authorized on the test data center')

    const me = await withTimeout(adapter.me(), 20_000, 'getMe')
    console.log(`  me.id      : ${me.id}`)

    const chats = await withTimeout(
      adapter.listChats({ limit: 50, offset: 0 }),
      30_000,
      'listChats',
    )
    console.log(`  chats      : ${chats.length}`)

    // Saved Messages is the safest chat to write into: a chat exists for it on
    // every account, and it belongs to this test account only.
    const saved = chats.find((chat) => chat.userId === me.id)
    if (!saved) throw new Error('Saved Messages is missing from the chat list')
    console.log(`  self chat  : ${saved.id}`)

    const marker = `WeGram test-DC ${new Date().toISOString()}`
    const local = await adapter.sendText({ chatId: saved.id, text: marker })
    // `sendMessage` answers with TDLib's *local* id; editing or deleting that id
    // fails with "Message not found" until the server ack swaps it, so every
    // follow-up waits for the row to stop changing.
    const sent = await settledMessage(
      saved.id,
      (message) => message.kind === 'text' && message.text.includes(marker),
      'the text message',
    )
    console.log(`  send       : ${local.localId} -> message ${sent.id}`)

    const edited = await editSettled(saved.id, marker, `${marker} (edited)`)
    if (!edited.text.includes('(edited)')) throw new Error('the edit did not survive')
    console.log('  edit       : ok')

    const photoPath = writeProbePng()
    await adapter.sendMedia({
      chatId: saved.id,
      filePath: photoPath,
      kind: 'photo',
      caption: 'WeGram test-DC photo',
    })
    const photo = await settledMessage(
      saved.id,
      (message) => message.kind === 'photo',
      'the photo',
      60_000,
    )
    console.log(`  photo      : message ${photo.id}`)

    /**
     * 语音消息: TDLib only accepts an OGG/Opus voice note (anything else would be
     * stored as an audio message), so the probe is a real clip recorded through
     * the app's own recorder — see `fixtures/voice-probe.ogg`. The waveform is
     * empty on purpose (the scheme does not define its packing).
     */
    await adapter.sendVoiceNote({
      chatId: saved.id,
      filePath: resolve('scripts/fixtures/voice-probe.ogg'),
      duration: 2,
    })
    const voice = await settledMessage(
      saved.id,
      (message) => message.kind === 'voice',
      'the voice note',
      60_000,
    )
    console.log(`  voice      : message ${voice.id} (${voice.media?.duration ?? '?'}s)`)

    if (cleanup) {
      const ids = [edited.id, photo.id, voice.id]
      await deleteSettled(saved.id, ids)
      await waitForGone(saved.id, ids)
      console.log('  delete     : ok')
    }

    console.log(
      `\n[PASS] send / edit / upload / voice${cleanup ? ' / delete' : ''} worked on the test DC`,
    )
  } catch (error) {
    console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`)
    console.error(`states seen: ${states.join(' -> ')}`)
    process.exitCode = 1
  } finally {
    clearTimeout(guard)
    await adapter.stop().catch(() => undefined)
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}

/**
 * Drives the four authorization steps the login window knows: phone, code,
 * registration (a fresh test number has no account yet) and — for completeness
 * — refuses 2FA, which a test number never has.
 */
async function authorize(): Promise<'ready' | 'await-code'> {
  const deadline = Date.now() + 90_000
  let phoneSent = false
  let codeTries = 0
  let registered = false

  let seen = ''
  while (Date.now() < deadline) {
    const state = adapter.getAuthState()
    const detail =
      state.kind === 'waitCode' ? `${state.kind}/len=${state.codeLength ?? '?'}` : state.kind
    if (detail !== seen) {
      seen = detail
      console.log(`  auth       : ${detail}`)
    }
    switch (state.kind) {
      case 'ready':
        return 'ready'
      case 'closed':
        throw new Error('TDLib closed during authorization')
      case 'waitPhoneNumber':
        if (!phoneSent) {
          phoneSent = true
          await adapter.submitPhone(phone)
        }
        break
      case 'waitCode': {
        if (codeTries > 0) break
        codeTries = 1
        const first = codeOverride ?? (isTestNumber ? String(dcId).repeat(5) : null)
        if (!first) {
          // Real number: the code is random and arrives by SMS, so this run can
          // only ask for it. The session keeps the state; the next run submits.
          return 'await-code'
        }
        try {
          await adapter.submitCode(first)
          break
        } catch (error) {
          if (codeOverride) {
            throw new Error(
              `the supplied code was rejected (${error instanceof Error ? error.message : String(error)})`,
            )
          }
          // Telegram has changed the test-code length before: retry once with
          // the six-digit form before giving up.
          codeTries = 2
          const second = first + first[0]
          console.log(
            `  code retry : ${second} (${first} rejected: ${error instanceof Error ? error.message : String(error)})`,
          )
          await adapter.submitCode(second)
          break
        }
      }
      case 'waitRegistration':
        if (!registered) {
          registered = true
          await adapter.signUp({ firstName: 'WeGram', lastName: 'Test' })
          console.log('  register   : created the test account')
        }
        break
      case 'waitPassword':
        throw new Error('this test number unexpectedly has two-step verification')
      default:
        break
    }
    await sleep(400)
  }
  throw new Error(`authorization did not settle (last: ${adapter.getAuthState().kind})`)
}

/** A row whose id stopped changing: TDLib replaces its local id with the server's. */
async function settledMessage(
  chatId: number,
  match: (message: Message) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<Message> {
  const deadline = Date.now() + timeoutMs
  let previousId = 0
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 20 })
    const found = page.messages.find(match)
    if (found && found.id === previousId) return found
    previousId = found?.id ?? 0
    await sleep(900)
  }
  throw new Error(`${label} never settled on a server id`)
}

/** `editMessageText` on a local id answers "Message not found"; retry after settling. */
async function editSettled(chatId: number, marker: string, text: string): Promise<Message> {
  const deadline = Date.now() + 30_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    const target = await settledMessage(
      chatId,
      (message) => message.kind === 'text' && message.text.includes(marker),
      'the text message',
      10_000,
    )
    try {
      return await adapter.editText({ chatId, messageId: target.id, text })
    } catch (error) {
      lastError = error
      await sleep(900)
    }
  }
  throw new Error(
    `the edit never landed (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  )
}

async function deleteSettled(chatId: number, ids: number[]): Promise<void> {
  const deadline = Date.now() + 30_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      await adapter.deleteMessages({ chatId, messageIds: ids, forBoth: true })
      return
    } catch (error) {
      lastError = error
      await sleep(900)
    }
  }
  throw new Error(
    `the delete never landed (${lastError instanceof Error ? lastError.message : String(lastError)})`,
  )
}

async function waitForGone(chatId: number, ids: number[]): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 50 })
    if (page.messages.every((message) => !ids.includes(message.id))) return
    await sleep(700)
  }
  throw new Error(`deleted messages ${ids.join(', ')} are still in history`)
}

/** A real 240×180 PNG, so the photo path (size probe + upload) is exercised. */
function writeProbePng(): string {
  const width = 240
  const height = 180
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = 30
      raw[row + 2 + x * 3] = 120
      raw[row + 3 + x * 3] = 220
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 2 // truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  const dir = join(tmpdir(), 'wegram-test-dc')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'probe.png')
  writeFileSync(file, png)
  return file
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

/**
 * Shared plumbing for the headless test-DC scripts (`tdlib:test-dc` and
 * `tdlib:test-dc:writes`): credentials / session / proxy resolution, the
 * authorization walk, the message-settling helpers and the PNG fixture.
 *
 * The guards that keep a run off the real account live here rather than in the
 * scripts, because both need them and neither may drift: a test-DC client cannot
 * open the production database, but a wrong session path is the one mistake with
 * real consequences (CLAUDE.md, hard rule 1). Writes only ever run against
 * Telegram's test data centers.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

import type { Message, ProxyConfig } from '@wegram/protocol'

import { TdlibAdapter } from '../../src/main/telegram/tdlib'
import { parseProxyUrl } from '../../src/main/proxy-url'
import { isOn, loadDotEnv } from '../dotenv'

export interface TestDcEnv {
  apiId: number
  apiHash: string
  phone: string
  /** 1-5 when the number is a test number, 0 for a real number. */
  dcId: number
  isTestNumber: boolean
  /** The code to submit, or null when the server has to ask for one. */
  code: string | null
  sessionDir: string
  initialProxy: ProxyConfig | null
  /** False with `WEGRAM_TEST_KEEP=1`: leave the probe rows behind. */
  cleanup: boolean
}

/** Reads `.env` plus the env overrides and refuses the real account's session. */
export function loadTestDcEnv(): TestDcEnv {
  loadDotEnv(join(process.cwd(), '.env'))

  const apiId = Number(process.env['TELEGRAM_API_ID'] ?? 0)
  const apiHash = (process.env['TELEGRAM_API_HASH'] ?? '').trim()
  if (!apiId || !apiHash) {
    console.error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in apps/desktop/.env')
    process.exit(2)
  }

  /**
   * Test DC numbers are `+99966<dc>YYYY` and answer with a derived code. A real
   * number also works on the test DCs, but Telegram sends it a real code, so it
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

  const sessionDir =
    process.env['TDLIB_SESSION_DIR']?.trim() || resolve('../../spikes/tdlib/test-data')
  if (resolve(sessionDir) === resolve('../../spikes/tdlib/data')) {
    console.error('Refusing to run: that is the real-account session directory')
    process.exit(2)
  }

  return {
    apiId,
    apiHash,
    phone,
    dcId: phoneMatch?.[1] ? Number(phoneMatch[1]) : 0,
    isTestNumber,
    code: process.env['WEGRAM_TEST_CODE']?.trim() || null,
    sessionDir,
    initialProxy: parseProxyUrl(process.env['TDLIB_PROXY']),
    cleanup: !isOn(process.env['WEGRAM_TEST_KEEP']),
  }
}

/** The six lines every run prints before it touches the network. */
export function printTestDcBanner(env: TestDcEnv): void {
  console.log(
    `phone      : ${env.phone}${env.isTestNumber ? ` (test dc ${env.dcId})` : ' (real number)'}`,
  )
  console.log(
    `code       : ${env.code ?? (env.isTestNumber ? String(env.dcId).repeat(5) : '(from the SMS, pass WEGRAM_TEST_CODE)')}`,
  )
  console.log(`session dir: ${env.sessionDir}`)
  console.log(
    `proxy      : ${env.initialProxy ? `${env.initialProxy.type} ${env.initialProxy.host}:${env.initialProxy.port}` : '(none)'}`,
  )
  console.log('test dc    : yes — nothing here can reach a real chat')
}

export function createTestDcAdapter(env: TestDcEnv): TdlibAdapter {
  return new TdlibAdapter({
    apiId: env.apiId,
    apiHash: env.apiHash,
    databaseDirectory: join(env.sessionDir, 'db'),
    filesDirectory: join(env.sessionDir, 'files'),
    initialProxy: env.initialProxy,
    useTestDc: true,
  })
}

/**
 * Drives the four authorization steps the login window knows: phone, code,
 * registration (a fresh test number has no account yet) and — for completeness
 * — refuses 2FA, which a test number never has.
 */
export async function authorizeTestDc(
  adapter: TdlibAdapter,
  env: TestDcEnv,
): Promise<'ready' | 'await-code'> {
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
          await adapter.submitPhone(env.phone)
        }
        break
      case 'waitCode': {
        if (codeTries > 0) break
        codeTries = 1
        const first = env.code ?? (env.isTestNumber ? String(env.dcId).repeat(5) : null)
        if (!first) {
          // Real number: the code is random and arrives out of band, so this run
          // can only ask for it. The session keeps the state; the next run submits.
          return 'await-code'
        }
        try {
          await adapter.submitCode(first)
          break
        } catch (error) {
          if (env.code) {
            throw new Error(`the supplied code was rejected (${errorText(error)})`)
          }
          // Telegram has changed the test-code length before: retry once with
          // the six-digit form before giving up.
          codeTries = 2
          const second = first + first[0]
          console.log(`  code retry : ${second} (${first} rejected: ${errorText(error)})`)
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

/** A row whose id stopped changing: TDLib replaces the local id with the server's. */
export async function settledMessage(
  adapter: TdlibAdapter,
  chatId: number,
  match: (message: Message) => boolean,
  label: string,
  timeoutMs = 30_000,
  /** 话题 (design doc §9.12): look inside one topic instead of the flat chat. */
  topicId?: number,
): Promise<Message> {
  const deadline = Date.now() + timeoutMs
  let previousId = 0
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, ...(topicId === undefined ? {} : { topicId }), limit: 20 })
    const found = page.messages.find(match)
    if (found && found.id === previousId) return found
    previousId = found?.id ?? 0
    await sleep(900)
  }
  throw new Error(`${label} never settled on a server id`)
}

/** The same idea for an album: N matches whose ids stopped changing. */
export async function settledMessages(
  adapter: TdlibAdapter,
  chatId: number,
  match: (message: Message) => boolean,
  count: number,
  label: string,
  timeoutMs = 30_000,
): Promise<Message[]> {
  const deadline = Date.now() + timeoutMs
  let previous = ''
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 30 })
    const found = page.messages.filter(match)
    const key = found.map((message) => message.id).join(',')
    if (found.length >= count && key === previous) return found.slice(0, count)
    previous = key
    await sleep(900)
  }
  throw new Error(`${label} never settled (${count} expected)`)
}

/** One row that satisfies `match`, for a change that lands as a content update. */
export async function waitForMessage(
  adapter: TdlibAdapter,
  chatId: number,
  match: (message: Message) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<Message> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 30 })
    const found = page.messages.find(match)
    if (found) return found
    await sleep(900)
  }
  throw new Error(`${label} never arrived`)
}

/** `editMessageText` on a local id answers "Message not found"; retry after settling. */
export async function editSettled(
  adapter: TdlibAdapter,
  chatId: number,
  marker: string,
  text: string,
): Promise<Message> {
  const deadline = Date.now() + 30_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    const target = await settledMessage(
      adapter,
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
  throw new Error(`the edit never landed (${errorText(lastError)})`)
}

export async function deleteSettled(
  adapter: TdlibAdapter,
  chatId: number,
  ids: number[],
): Promise<void> {
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
  throw new Error(`the delete never landed (${errorText(lastError)})`)
}

export async function waitForGone(
  adapter: TdlibAdapter,
  chatId: number,
  ids: number[],
): Promise<void> {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 50 })
    if (page.messages.every((message) => !ids.includes(message.id))) return
    await sleep(700)
  }
  throw new Error(`deleted messages ${ids.join(', ')} are still in history`)
}

/** A real 240×180 PNG, so the photo path (size probe + upload) is exercised. */
export function writeProbePng(
  name = 'probe',
  rgb: [number, number, number] = [30, 120, 220],
): string {
  const width = 240
  const height = 180
  const raw = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1)
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0]
      raw[row + 2 + x * 3] = rgb[1]
      raw[row + 3 + x * 3] = rgb[2]
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
  const file = join(dir, `${name}.png`)
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

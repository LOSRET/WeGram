/**
 * Headless smoke test for the real TDLib adapter.
 *
 * Electron cannot be launched in every environment, so this script exercises
 * the same code path the app uses (Client creation, authorization state machine,
 * getMe, getChats) directly under Node. It prints no personal data: only ids,
 * counts and enums.
 *
 *   cd apps\desktop
 *   pnpm tdlib:smoke
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { TdlibAdapter } from '../src/main/telegram/tdlib'
import { parseProxyUrl } from '../src/main/proxy-url'

loadDotEnv(join(process.cwd(), '.env'))

const apiId = Number(process.env['TELEGRAM_API_ID'] ?? 0)
const apiHash = (process.env['TELEGRAM_API_HASH'] ?? '').trim()

if (!apiId || !apiHash) {
  console.error('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH in apps/desktop/.env')
  process.exit(2)
}

const sessionDir = process.env['TDLIB_SESSION_DIR']?.trim() || resolve('../../spikes/tdlib/data')
const initialProxy = parseProxyUrl(process.env['TDLIB_PROXY'])
console.log(`session dir: ${sessionDir}`)
console.log(
  `proxy      : ${initialProxy ? `${initialProxy.type} ${initialProxy.host}:${initialProxy.port}` : '(none)'}`,
)

const adapter = new TdlibAdapter({
  apiId,
  apiHash,
  databaseDirectory: join(sessionDir, 'db'),
  filesDirectory: join(sessionDir, 'files'),
  initialProxy,
})

const states: string[] = []
adapter.onEvent((event) => {
  if (event.type === 'auth') states.push(`auth:${event.state.kind}`)
  if (event.type === 'connection') states.push(`conn:${event.state}`)
})

const timeout = setTimeout(() => {
  console.error(`\n[FAIL] timed out; states seen: ${states.join(' -> ')}`)
  process.exit(1)
}, 45_000)

void main()

async function main(): Promise<void> {
  try {
    await adapter.start()
    const authState = await waitForSettledAuth(adapter, 30_000)
    console.log(`\n[PASS] adapter started`)
    console.log(`  auth state : ${authState.kind}`)

    if (authState.kind !== 'ready') {
      console.log('  (not authorized: in-app login would be required)')
    } else {
      const me = await withTimeout(adapter.me(), 15_000, 'getMe')
      console.log(`  me.id      : ${me.id}`)
      console.log(`  username   : ${me.username ? '(set)' : '(none)'}`)
      console.log(`  phone      : ${me.phone ? '(set)' : '(none)'}`)

      const chats = await withTimeout(
        adapter.listChats({ limit: 20, offset: 0 }),
        20_000,
        'listChats (needs network unless the chat list is cached)',
      )
      const kinds = chats.reduce<Record<string, number>>((acc, chat) => {
        acc[chat.kind] = (acc[chat.kind] ?? 0) + 1
        return acc
      }, {})
      console.log(`  chats      : ${chats.length} (${JSON.stringify(kinds)})`)
      console.log(`  unread sum : ${chats.reduce((sum, chat) => sum + chat.unread, 0)}`)

      if (process.env['SMOKE_DEBUG']) {
        for (const chat of chats.slice(0, 10)) {
          console.log(
            `    chat ${chat.id} kind=${chat.kind} unread=${chat.unread} pinned=${chat.pinned} muted=${chat.muted} lastAt=${chat.lastMessageAt ?? 0}`,
          )
        }
      }

      const first = chats[0]
      if (first) {
        const history = await withTimeout(
          adapter.history({ chatId: first.id, limit: 10 }),
          20_000,
          'history',
        )
        console.log(
          `  history    : ${history.messages.length} messages, hasMore=${history.hasMore}`,
        )
        const kindsSeen = [...new Set(history.messages.map((message) => message.kind))]
        console.log(`  msg kinds  : ${kindsSeen.join(', ') || '(none)'}`)

        // Channel posts are sent by the chat itself; this is the regression check
        // for `senderChatId` + the channel title instead of `未知`.
        const channel = chats.find((chat) => chat.kind === 'channel')
        if (channel) {
          const page = await withTimeout(
            adapter.history({ chatId: channel.id, limit: 20 }),
            20_000,
            `channel history(${channel.id})`,
          )
          const byChat = page.messages.filter((message) => message.senderChatId)
          const names = [...new Set(byChat.map((message) => message.senderName))].slice(0, 3)
          console.log(
            `  senderChat : ${byChat.length}/${page.messages.length} channel msgs carry senderChatId, names=${names.join(' | ') || '(none)'}`,
          )
        }

        if (process.env['SMOKE_DEBUG']) {
          for (const chat of chats.slice(0, 3)) {
            const page = await withTimeout(
              adapter.history({ chatId: chat.id, limit: 50 }),
              20_000,
              `history(${chat.id})`,
            )
            const senderNames = [...new Set(page.messages.map((m) => m.senderName))]
            console.log(
              `    history ${chat.id}: ${page.messages.length} msgs, hasMore=${page.hasMore}, senders=${senderNames.length}, edited=${page.messages.filter((m) => m.edited).length}`,
            )
          }
        }
      }
    }
  } catch (error) {
    console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`)
    console.error(`states seen: ${states.join(' -> ')}`)
    process.exitCode = 1
  } finally {
    clearTimeout(timeout)
    await adapter.stop().catch(() => undefined)
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}

async function waitForSettledAuth(
  target: TdlibAdapter,
  waitMs: number,
): Promise<ReturnType<TdlibAdapter['getAuthState']>> {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    const state = target.getAuthState()
    if (state.kind === 'ready' || state.kind === 'waitPhoneNumber') return state
    if (state.kind === 'closed') throw new Error('TDLib closed unexpectedly')
    await sleep(250)
  }
  throw new Error('authorization state did not settle')
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

function loadDotEnv(file: string): void {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (!match?.[1]) continue
      if (process.env[match[1]]) continue
      process.env[match[1]] = (match[2] ?? '').replace(/^["']|["']$/g, '')
    }
  } catch {
    // No .env is reported by the credential check above.
  }
}

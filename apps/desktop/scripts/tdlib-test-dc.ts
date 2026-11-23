/**
 * Headless run against Telegram's test data centers — the one place the write
 * paths may be exercised with real TDLib.
 *
 * The test DCs are a separate account space: every `99966XYYYY` number is its
 * own account, the code is derived from the data-center id and nothing there can
 * reach a real chat. Send / edit / delete / upload / 语音消息 are proven here,
 * which the mock adapter cannot do for TDLib-specific behaviour and a real
 * session must never do (CLAUDE.md: 真实账号只读).
 *
 *   cd apps\desktop
 *   pnpm tdlib:test-dc          # this baseline: text / edit / photo / voice / delete
 *   pnpm tdlib:test-dc:writes   # the rest of the §9.1 write debt
 *
 * Env: TDLIB_PROXY (`socks5://host:port` or `http://host:port`), TDLIB_SESSION_DIR
 * (defaults to `spikes/tdlib/test-data`), WEGRAM_TEST_PHONE (default `+9996620001`),
 * WEGRAM_TEST_CODE, WEGRAM_TEST_KEEP=1 (leave the probe rows behind).
 */
import { resolve } from 'node:path'

import {
  authorizeTestDc,
  createTestDcAdapter,
  deleteSettled,
  editSettled,
  loadTestDcEnv,
  printTestDcBanner,
  settledMessage,
  waitForGone,
  withTimeout,
  writeProbePng,
} from './testdc/harness'

const env = loadTestDcEnv()
printTestDcBanner(env)

const adapter = createTestDcAdapter(env)

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
    const outcome = await authorizeTestDc(adapter, env)
    if (outcome === 'await-code') {
      console.log(
        '\n[WAIT] the code was requested — rerun with WEGRAM_TEST_CODE=<the code Telegram sent>',
      )
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
      adapter,
      saved.id,
      (message) => message.kind === 'text' && message.text.includes(marker),
      'the text message',
    )
    console.log(`  send       : ${local.localId} -> message ${sent.id}`)

    const edited = await editSettled(adapter, saved.id, marker, `${marker} (edited)`)
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
      adapter,
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
      adapter,
      saved.id,
      (message) => message.kind === 'voice',
      'the voice note',
      60_000,
    )
    console.log(`  voice      : message ${voice.id} (${voice.media?.duration ?? '?'}s)`)

    if (env.cleanup) {
      const ids = [edited.id, photo.id, voice.id]
      await deleteSettled(adapter, saved.id, ids)
      await waitForGone(adapter, saved.id, ids)
      console.log('  delete     : ok')
    }

    console.log(
      `\n[PASS] send / edit / upload / voice${env.cleanup ? ' / delete' : ''} worked on the test DC`,
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

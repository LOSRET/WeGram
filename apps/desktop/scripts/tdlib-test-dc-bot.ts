/**
 * 机器人 (design doc §8.3) against Telegram's test data centers: the command list
 * a bot publishes (the composer's "/" list) and pressing one of its inline
 * buttons (`getCallbackQueryAnswer`).
 *
 *   cd apps\desktop
 *   pnpm tdlib:test-dc:bot
 *
 * Writes stay on the test DCs; nothing here can reach a real chat. BotFather is
 * the target because it is the one bot on the test DCs that can produce a callback
 * keyboard without a bot server behind it: `/mybots` answers a list of this
 * account's bots as inline buttons, so pressing one exercises the whole path.
 * An account with no bots yet gets one created by the script (a throwaway
 * `wegram_<suffix>_bot`, which the test DCs cannot leak anywhere).
 */
import type { Message } from '@wegram/protocol'

import {
  authorizeTestDc,
  createTestDcAdapter,
  errorText,
  loadTestDcEnv,
  printTestDcBanner,
  sleep,
  withTimeout,
} from './testdc/harness'

const env = loadTestDcEnv()
printTestDcBanner(env)

const adapter = createTestDcAdapter(env)
const failures: string[] = []

const guard = setTimeout(() => {
  console.error('\n[FAIL] timed out before the bot checks finished')
  process.exit(1)
}, 240_000)

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

    const chat = await withTimeout(
      adapter.openUsernameChat('BotFather'),
      30_000,
      'openUsernameChat(BotFather)',
    )
    console.log(`  bot chat   : ${chat.title} (${chat.id})`)

    // 1. The command list the composer's "/" popup draws.
    const commands = await withTimeout(adapter.botCommands(chat.id), 20_000, 'botCommands')
    console.log(`  is a bot   : ${commands.isBot}`)
    console.log(
      `  commands   : ${commands.commands.map((command) => '/' + command.command).join(' ')}`,
    )
    if (!commands.isBot) throw new Error('BotFather did not answer as a bot chat')
    if (commands.commands.length === 0) throw new Error('BotFather published no commands')
    console.log('  [PASS]     the command list')

    // 2. Pressing a callback button. /mybots answers this account's bots as an
    //    inline keyboard; an account without one gets a throwaway bot first.
    let keyboard = await askForKeyboard(chat.id, '/mybots', 15_000)
    if (!keyboard) {
      console.log('  create bot : no bots on this account yet — creating one')
      await createThrowawayBot(chat.id)
      keyboard = await askForKeyboard(chat.id, '/mybots', 30_000)
    }
    if (!keyboard) {
      console.log('  callback   : BotFather answered no keyboard — skipped')
      return
    }

    const button = keyboard.buttons?.flat().find((item) => item.callback !== undefined)
    if (!button?.callback) {
      console.log('  callback   : the keyboard has no callback button — skipped')
      return
    }
    const answer = await withTimeout(
      adapter.pressCallback({
        chatId: chat.id,
        messageId: keyboard.id,
        callback: button.callback,
      }),
      30_000,
      'pressCallback',
    )
    console.log(`  pressed    : ${button.text}`)
    console.log(`  answer     : ${JSON.stringify(answer)}`)
    console.log('  [PASS]     the callback query')
  } catch (error) {
    failures.push(errorText(error))
    console.error(`\n[FAIL] ${errorText(error)}`)
  } finally {
    clearTimeout(guard)
    await adapter.stop().catch(() => undefined)
    process.exitCode = failures.length > 0 ? 1 : 0
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}

/** Sends a command and waits for the answer that carries an inline keyboard. */
async function askForKeyboard(
  chatId: number,
  command: string,
  timeoutMs: number,
): Promise<Message | null> {
  const sent = await adapter.sendText({ chatId, text: command })
  return waitFor(
    chatId,
    sent.message.id,
    timeoutMs,
    (message) => (message.buttons?.length ?? 0) > 0,
  )
}

/**
 * Creates a throwaway bot through BotFather: name, then a username ending in
 * `bot`, answered by the token message. Only used when the account has none, so
 * a rerun finds the one created before and skips this.
 */
async function createThrowawayBot(chatId: number): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 8)
  await adapter.sendText({ chatId, text: '/newbot' })
  await sleep(2_500)
  await adapter.sendText({ chatId, text: `WeGram Test ${suffix}` })
  await sleep(2_500)
  const sent = await adapter.sendText({ chatId, text: `wegram_${suffix}_bot` })
  const token = await waitFor(chatId, sent.message.id, 40_000, (message) =>
    /token/i.test(message.text),
  )
  if (!token) throw new Error('BotFather never answered the token for the new bot')
}

/**
 * Polls the transcript for an incoming row newer than `afterId` that matches.
 * A bot's answer may be edited in place, so the whole recent page is re-read.
 */
async function waitFor(
  chatId: number,
  afterId: number,
  timeoutMs: number,
  match: (message: Message) => boolean,
): Promise<Message | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = await adapter.history({ chatId, limit: 10 })
    const found = page.messages.find(
      (message) => !message.outgoing && message.id > afterId && match(message),
    )
    if (found) return found
    await sleep(1_000)
  }
  return null
}

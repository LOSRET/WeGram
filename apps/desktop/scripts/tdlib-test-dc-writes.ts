/**
 * The write paths `docs/HANDOFF.md` §9.1 lists as "compile/mock-verified only":
 * each one is driven here against Telegram's test data centers, the only place a
 * write may run with real TDLib.
 *
 *   cd apps\desktop
 *   pnpm tdlib:test-dc:writes
 *
 * Outcomes, because "verified" has to mean something specific:
 *   PASS     the server stored the change and it read back;
 *   PARTIAL  the call path and TDLib's answer were exercised, but this account
 *            offers no fixture for the full round trip (no failed row to 重试,
 *            no Premium for 转文字, no shared group);
 *   SKIP     the API itself refuses on this target (举报 a person is bots-only);
 *   FAIL     the code's fault — a shape or mapping bug.
 *
 * WEGRAM_TEST_KEEP=1 leaves the probe rows behind; otherwise they are deleted.
 */
import type { Message } from '@wegram/protocol'

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
  waitForMessage,
  withTimeout,
  writeProbePng,
} from './testdc/harness'

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

/**
 * Not a defect: the API or this account cannot exercise the full path today.
 * `partial` separates "the call worked but proved less" from "the call was not
 * even reachable".
 */
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
    const contacts = await adapter.listContacts()
    const self = chats.find((chat) => chat.userId === me.id)
    if (!self) throw new Error('Saved Messages is missing from the chat list')

    /**
     * The person the notes / block / contact / shared-group checks need. The
     * test account is freshly created, so this is normally the Telegram service
     * account (777000) — a real user object, which is all those calls want.
     */
    const peers = chats.filter(
      (chat) => chat.kind === 'private' && typeof chat.userId === 'number' && chat.userId !== me.id,
    )
    let peerId: number | null = peers[0]?.userId ?? contacts[0]?.userId ?? null
    if (peerId === null) {
      /**
       * 777000 is Telegram's own notifications account: every account has it in
       * the user cache, so it can restore the person fixture after a previous run
       * deleted that chat. One message is what puts a chat back in the list.
       */
      const service = await adapter.openPrivateChat(777000)
      await adapter.sendText({ chatId: service.id, text: `WeGram fixture ${Date.now()}` })
      peerId = 777000
    }

    /**
     * 共同群聊 needs somebody this account shares a group with, which is not the
     * same person as the one in a private chat. Look through the groups we can
     * read for a second member; a group with only ourselves in it is no fixture.
     */
    let commonPeerId: number | null = null
    for (const chat of chats) {
      if (chat.kind !== 'group') continue
      const members = await adapter.chatMembers(chat.id, 20)
      const other = members.find((member) => member.userId !== me.id)
      if (other) {
        commonPeerId = other.userId
        break
      }
    }

    console.log(`  me         : ${me.id}`)
    console.log(`  self chat  : ${self.id}`)
    console.log(`  chats      : ${chats.length} (${chats.map((chat) => chat.kind).join(', ')})`)
    console.log(`  contacts   : ${contacts.length}`)
    console.log(`  peer       : ${peerId ?? '(none — a second user is required)'}`)
    console.log(`  group peer : ${commonPeerId ?? '(none — no group with a second member)'}`)
    console.log('')

    // ---- sendChatAction: typing, recording, and the cancel that ends either ---
    await check('typing', async () => {
      await adapter.sendTyping(self.id, true, 'typing')
      await sleep(400)
      await adapter.sendTyping(self.id, false)
      await adapter.sendTyping(self.id, true, 'recording')
      await sleep(400)
      await adapter.sendTyping(self.id, false)
      // `sendTyping` swallows failures on purpose (typing is ambient presence),
      // so the call path is all this can prove; the state on the wire is not
      // observable from this side.
      limited(
        'chatActionTyping / RecordingVoiceNote / chatActionCancel sent; errors are swallowed by design',
        true,
      )
    })

    // ---- sendMessageAlbum + editMessageCaption -------------------------------
    let album: Message[] = []
    await check('album', async () => {
      const marker = `WeGram album ${Date.now()}`
      const sent = await adapter.sendAlbum({
        chatId: self.id,
        items: [
          {
            filePath: writeProbePng('probe-a', [214, 76, 60]),
            kind: 'photo',
            caption: `${marker} 1`,
          },
          {
            filePath: writeProbePng('probe-b', [62, 154, 92]),
            kind: 'photo',
            caption: `${marker} 2`,
          },
        ],
      })
      album = await settledMessages(
        adapter,
        self.id,
        (message) => message.kind === 'photo' && message.text.includes(marker),
        2,
        'the album items',
        90_000,
      )
      probeIds.push(...album.map((message) => message.id))
      const albumIds = [
        ...new Set(
          album
            .map((message) => message.albumId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        ),
      ]
      if (albumIds.length !== 1) {
        throw new Error(
          `the two photos did not share one media_album_id (${JSON.stringify(albumIds)})`,
        )
      }
      return `2 photos stored, album ${albumIds[0]}, ${sent.localIds.length} local ids tracked`
    })

    await check('editCaption', async () => {
      const target = album[0]
      if (!target) limited('the album check left no photo to caption', true)
      const caption = `WeGram caption ${Date.now()}`
      await adapter.editCaption({ chatId: self.id, messageId: target.id, caption })
      const updated = await waitForMessage(
        adapter,
        self.id,
        (message) => message.id === target.id && message.text === caption,
        'the rewritten caption',
      )
      return `message ${target.id} caption -> "${updated.text}"`
    })

    // ---- pinChatMessage / unpinChatMessage -----------------------------------
    await check('pinMessage', async () => {
      const marker = `WeGram pin ${Date.now()}`
      await adapter.sendText({ chatId: self.id, text: marker })
      const row = await settledMessage(
        adapter,
        self.id,
        (message) => message.kind === 'text' && message.text.includes(marker),
        'the row to pin',
      )
      probeIds.push(row.id)
      const props = await adapter.messageProperties({ chatId: self.id, messageId: row.id })
      const pinned = await adapter.setPinnedMessage(self.id, row.id)
      if (!pinned || pinned.messageId !== row.id) {
        throw new Error(`pin answered ${JSON.stringify(pinned)}`)
      }
      const read = await adapter.pinnedMessage(self.id)
      if (!read || read.messageId !== row.id) {
        throw new Error(`pinnedMessage() read ${JSON.stringify(read)}`)
      }
      const cleared = await adapter.setPinnedMessage(self.id, null)
      if (cleared !== null) throw new Error('unpin answered a message')
      const gone = await adapter.pinnedMessage(self.id)
      if (gone !== null) throw new Error('the pin survived the unpin')
      return `pinned ${row.id} (can_be_pinned=${props.canBePinned}), read back, unpinned`
    })

    // ---- toggleChatIsMarkedAsUnread ------------------------------------------
    await check('markUnread', async () => {
      const marked = await adapter.setChatUnread(self.id, true)
      if (marked.markedUnread !== true) throw new Error('标为未读 did not stick on the summary')
      const read = await adapter.setChatUnread(self.id, false)
      if (read.markedUnread === true) throw new Error('标为已读 did not clear the flag')
      return 'markedUnread set, read back, cleared'
    })

    // ---- setUserNote ---------------------------------------------------------
    await check('setUserNote', async () => {
      if (peerId === null) limited('the account has no second user to write a note on')
      // TDLib answers "User isn't a contact" for anybody outside the address
      // book, so the note path only exists once the person was added — which is
      // also why the card gates its 备注 row on `isContact`.
      const before = await adapter.userProfile(peerId)
      if (!before.isContact) await adapter.setUserContact(peerId, true)
      try {
        const note = `WeGram note ${Date.now()}`
        const written = await adapter.setUserNote(peerId, note)
        if (written.note !== note)
          throw new Error(`the card read back ${JSON.stringify(written.note)}`)
        const cleared = await adapter.setUserNote(peerId, '')
        if (cleared.note) throw new Error(`the note did not clear (${cleared.note})`)
        return `note written and cleared on ${peerId}`
      } finally {
        if (!before.isContact) await adapter.setUserContact(peerId, false)
      }
    })

    // ---- addContact / removeContacts ----------------------------------------
    await check('contacts', async () => {
      if (peerId === null) limited('the account has no second user to add')
      const before = await adapter.userProfile(peerId)
      const removed = await adapter.setUserContact(peerId, false)
      if (removed.isContact) throw new Error('removeContacts left is_contact true')
      const added = await adapter.setUserContact(peerId, true)
      if (!added.isContact) throw new Error('addContact left is_contact false')
      // The flag and the address book are two views of one write; both must agree.
      const listed = await adapter.listContacts()
      if (!listed.some((contact) => contact.userId === peerId)) {
        throw new Error(`${peerId} is a contact but is missing from getContacts`)
      }
      const again = await adapter.setUserContact(peerId, false)
      if (again.isContact) throw new Error('the second removeContacts did not stick')
      if (before.isContact) await adapter.setUserContact(peerId, true)
      return `addContact + removeContacts round trip on ${peerId}`
    })

    // ---- setMessageSenderBlockList ------------------------------------------
    await check('blockUser', async () => {
      if (peerId === null) limited('the account has no second user to block')
      const blocked = await adapter.setUserBlocked(peerId, true)
      if (!blocked.blocked) throw new Error('the card did not report the block')
      const unblocked = await adapter.setUserBlocked(peerId, false)
      if (unblocked.blocked) throw new Error('the block did not clear')
      return `blocked and unblocked ${peerId}`
    })

    // ---- getGroupsInCommon ---------------------------------------------------
    await check('groupsInCommon', async () => {
      if (commonPeerId === null) {
        limited('no group on this account has a second member — needs a second account')
      }
      const profile = await adapter.userProfile(commonPeerId)
      if (profile.commonChats === 0) {
        throw new Error(`group_in_common_count is 0 for ${commonPeerId}, who is in a group`)
      }
      const groups = await adapter.commonChats({ userId: commonPeerId, limit: 50 })
      if (groups.length === 0) {
        throw new Error('group_in_common_count > 0 but getGroupsInCommon answered nothing')
      }
      const wrong = groups.find((group) => group.kind !== 'group')
      if (wrong) throw new Error(`a non-group chat came back (${wrong.kind} ${wrong.id})`)
      return `${groups.length} shared group(s) with ${commonPeerId}`
    })

    // ---- reportChat (举报 a bot / one message) -------------------------------
    await check('reportChat', async () => {
      /**
       * 举报 a *person* is bots-only in TDLib (`can_report_user` requires
       * `is_bot`), so the bot on the test DC is the only target that can reach
       * the filer here. Its chain is longer than the sheet's two steps — reason
       * → "what is wrong with this bot?" → filed — which is exactly the case
       * `mapReportResult` has to survive: a second answer that carries a *new*
       * option list instead of `reported`.
       */
      let bot: { userId: number; name: string } | null = null
      for (const name of ['spambot', 'botfather']) {
        try {
          const chat = await adapter.openUsernameChat(name)
          if (!chat.userId) continue
          const profile = await adapter.userProfile(chat.userId)
          if (profile.canBeReported) {
            bot = { userId: profile.userId, name }
            break
          }
        } catch {
          // A name this test DC does not have is not a failure of the report path.
        }
      }

      if (bot) {
        let answer = await adapter.reportUser(bot.userId, {})
        let phases = 1
        while (!answer.reported && phases < 5) {
          const options = answer.options ?? []
          if (options.length === 0) {
            limited(`phase ${phases} asked "${answer.title ?? '?'}" without reasons`, true)
          }
          // The least specific reason Telegram offers is the safest thing to file.
          const pick =
            options.find((option) =>
              /^(Other|Something else|I don't like it)$/.test(option.text),
            ) ?? options[0]
          if (!pick) limited(`phase ${phases} carried an empty reason list`, true)
          answer = await adapter.reportUser(bot.userId, {
            optionId: pick.id,
            ...(answer.textRequired ? { text: 'WeGram test-DC probe' } : {}),
          })
          phases += 1
        }
        if (!answer.reported) {
          limited(`still unfiled after ${phases} phase(s): ${JSON.stringify(answer)}`, true)
        }
        return `@${bot.name} filed after ${phases} phase(s)`
      }

      /**
       * No reportable bot: the per-message path is the only one left, and TDLib
       * gates it on `can_report_chat`. A probe row makes the question askable.
       */
      if (peerId === null) limited('no bot and no second user to report')
      const chat = await adapter.openPrivateChat(peerId)
      await adapter.sendText({ chatId: chat.id, text: `WeGram report probe ${Date.now()}` })
      const own = await settledMessage(
        adapter,
        chat.id,
        (message) => message.kind === 'text' && message.outgoing,
        'the probe row',
        30_000,
      )
      const props = await adapter.messageProperties({ chatId: chat.id, messageId: own.id })
      if (props.canReportChat !== true) {
        limited(
          `no reportable bot on this DC, and a human is refused (can_report_user is bots-only; can_report_chat=${props.canReportChat})`,
        )
      }
      const phase1 = await adapter.reportMessage({ chatId: chat.id, messageId: own.id })
      if (!phase1.options?.length) throw new Error(`no reason list (${JSON.stringify(phase1)})`)
      return `message ${own.id} reason list: ${phase1.options.map((option) => option.text).join(' / ')}`
    })

    // ---- recognizeSpeech (转文字) ------------------------------------------
    await check('transcribe', async () => {
      /**
       * The recogniser on the test DC is intermittent (measured: one run filed a
       * transcript, the next answered TRANSCRIPTION_FAILED for the same clip), so
       * the check gets a second, freshly uploaded clip before it calls the path
       * unproven — a failure here must mean the *code* was wrong, not the server.
       */
      const failures: string[] = []
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        await adapter.sendVoiceNote({
          chatId: self.id,
          filePath: 'scripts/fixtures/voice-probe.ogg',
          duration: 2,
        })
        const voice = await settledMessage(
          adapter,
          self.id,
          (message) => message.kind === 'voice',
          'the voice note',
          60_000,
        )
        probeIds.push(voice.id)
        const props = await adapter.messageProperties({ chatId: self.id, messageId: voice.id })
        if (props.canRecognizeSpeech !== true) {
          failures.push(`attempt ${attempt}: can_recognize_speech=${props.canRecognizeSpeech}`)
          continue
        }
        await adapter.transcribeMessage({ chatId: self.id, messageId: voice.id })
        const done = await waitForMessage(
          adapter,
          self.id,
          (message) => message.id === voice.id && message.transcription !== undefined,
          'the transcript',
          45_000,
        ).catch((error: unknown) => {
          failures.push(`attempt ${attempt}: ${errorText(error)}`)
          return null
        })
        const transcription = done?.transcription
        if (transcription?.status === 'done') {
          return `message ${voice.id} -> "${transcription.text ?? ''}" (attempt ${attempt})`
        }
        failures.push(
          `attempt ${attempt}: ${transcription?.status ?? 'no field'}${transcription?.error ? ` (${transcription.error})` : ''}`,
        )
      }
      limited(`speech recognition never completed — ${failures.join(' | ')}`, true)
    })

    // ---- resendMessages (重试) ---------------------------------------------
    await check('resend', async () => {
      const page = await adapter.history({ chatId: self.id, limit: 30 })
      const failed = page.messages.find((message) => message.sendingState === 'failed')
      if (!failed) {
        const delivered = page.messages.find(
          (message) => message.kind === 'text' && message.sendingState === undefined,
        )
        if (!delivered) limited('no row to aim resendMessages at', true)
        try {
          await adapter.resendMessages(self.id, [delivered.id])
          limited(
            `no failed row existed; resendMessages accepted delivered ${delivered.id} — retry state unproven`,
            true,
          )
        } catch (error) {
          limited(
            `no failed row existed; resendMessages rejected delivered ${delivered.id}: ${errorText(error)}`,
            true,
          )
        }
      }
      await adapter.resendMessages(self.id, [failed.id])
      const after = await waitForMessage(
        adapter,
        self.id,
        (message) => message.id === failed.id && message.sendingState !== 'failed',
        'the resent row',
      )
      return `resent ${failed.id} -> ${after.sendingState ?? 'delivered'}`
    })

    // ---- deleteChatHistory (删除聊天) ---------------------------------------
    await check('deleteChat', async () => {
      if (peerId === null) limited('the account has no private chat to delete')
      /**
       * A chat enters the list with its first message, so the probe sends one:
       * deleting a chat the account already had would destroy a real
       * conversation on the way to proving a delete. The bot's chat is the
       * disposable one — the person chat is the fixture the other checks need.
       */
      let target: number | null = null
      try {
        const bot = await adapter.openUsernameChat('spambot')
        if (bot.userId) target = (await adapter.openPrivateChat(bot.userId)).id
      } catch {
        target = null
      }
      const chat = await adapter.openPrivateChat(target ?? peerId)
      await adapter.sendText({ chatId: chat.id, text: `WeGram delete probe ${Date.now()}` })
      await settledMessage(
        adapter,
        chat.id,
        (message) => message.kind === 'text' && message.outgoing,
        'the row that puts the chat in the list',
        60_000,
      )
      await adapter.deleteChat(chat.id)
      const after = await adapter.listChats({ limit: 50, offset: 0 })
      if (after.some((row) => row.id === chat.id)) {
        throw new Error(`chat ${chat.id} is still in the list after deleteChatHistory`)
      }
      return `deleteChatHistory removed ${chat.id} and its history`
    })

    // ---- cleanup: the probe rows in Saved Messages ---------------------------
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

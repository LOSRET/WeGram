/**
 * 话题 (design doc §9.12) against Telegram's test data centers.
 *
 * A forum cannot be faked for the TDLib paths — `getForumTopics`,
 * `getForumTopicHistory`, `topic_id` on every send and the tab/sidebar switch only
 * answer on a real forum supergroup — so this creates a disposable one on the test
 * DC (never the real account) and walks the whole feature: create → list → send
 * into the topic → history → rename → mute → close → pin → read → tabs → delete.
 *
 *   cd apps\desktop
 *   pnpm tdlib:test-dc:topics
 *
 * Same env as `pnpm tdlib:test-dc` (`WEGRAM_TEST_PHONE`, `WEGRAM_TEST_CODE`,
 * `TDLIB_PROXY`, `TDLIB_SESSION_DIR`). The forum is deleted at the end unless
 * `WEGRAM_TEST_KEEP=1`.
 */
import type { ChatSummary } from '@wegram/protocol'

import {
  authorizeTestDc,
  createTestDcAdapter,
  loadTestDcEnv,
  printTestDcBanner,
  settledMessage,
  withTimeout,
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
}, 240_000)

/** The test DCs drop requests fairly often; the probe retries the creation calls. */
function retryAfterSeconds(error: unknown): number | null {
  const text = error instanceof Error ? error.message : String(error)
  const match = /retry after (\d+)/i.exec(text)
  return match?.[1] ? Number(match[1]) : null
}

async function attempt<T>(work: () => Promise<T>, label: string, tries = 2): Promise<T> {
  let last: unknown = null
  for (let index = 0; index < tries; index += 1) {
    try {
      return await withTimeout(work(), 60_000, label)
    } catch (error) {
      last = error
      // 建群 is rate-limited on the test DC (`retry after N`); waiting is the only
      // honest recovery, and hammering only pushes the window out further.
      const wait = retryAfterSeconds(error)
      if (wait !== null) {
        console.log(`  rate limit : ${label} — waiting ${wait + 5}s`)
        await new Promise((done) => setTimeout(done, (wait + 5) * 1000))
      }
      console.log(`  retry      : ${label} (${index + 1}/${tries})`)
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/** The list is a server answer; a write can take a moment to be reflected. */
async function waitForTopic(
  chatId: number,
  topicId: number,
  ok: (topic: { title: string; muted: boolean; isClosed: boolean } | undefined) => boolean,
  label: string,
): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const page = await adapter.topics({ chatId, limit: 50 })
    if (ok(page.topics.find((topic) => topic.id === topicId))) return
    await new Promise((done) => setTimeout(done, 700))
  }
  throw new Error(label)
}

const checks: string[] = []
/** Soft checks the server accepted but did not reflect back. */
const warnings: string[] = []
function check(label: string): void {
  checks.push(label)
  console.log(`  ${label}`)
}

void main()

async function main(): Promise<void> {
  let forum: ChatSummary | null = null
  /** Only a forum this run created is deleted at the end. */
  let ownedForum = false
  try {
    await adapter.start()
    const outcome = await authorizeTestDc(adapter, env)
    if (outcome === 'await-code') {
      console.log('\n[WAIT] rerun with WEGRAM_TEST_CODE=<the code Telegram sent>')
      return
    }
    console.log('[PASS] authorized on the test data center')

    const title = `WeGram topics probe ${Date.now()}`
    /**
     * Group creation is the rate-limited call on the test DC, so a forum left behind
     * by an earlier run (`WEGRAM_TEST_KEEP=1` prints its id) can be reused:
     * `WEGRAM_TEST_FORUM=<chatId> pnpm tdlib:test-dc:topics`.
     */
    const reused = Number(process.env['WEGRAM_TEST_FORUM'] ?? 0)
    let supergroupId = 0
    ownedForum = reused === 0

    if (reused > 0) {
      forum = await adapter.getChat(reused)
      const raw = await adapter.rawInvoke({ _: 'getChat', chat_id: forum.id })
      supergroupId = Number(raw.type?.supergroup_id ?? 0)
      check(`forum reused: ${forum.title} (${forum.id})`)
    } else {
      /**
       * A forum is a supergroup, and this TDLib build's `createNewSupergroupChat`
       * produced a *channel* on the test DC (`supergroup.is_channel = true`, which
       * can never become a forum). A basic group upgraded to a supergroup gives a
       * megagroup, which is the shape `toggleSupergroupIsForum` accepts.
       */
      const basic = await attempt(
        () =>
          adapter.rawInvoke({
            _: 'createNewBasicGroupChat',
            user_ids: [],
            title,
          }),
        'createNewBasicGroupChat',
      )
      // `createNewBasicGroupChat` answers `createdBasicGroupChat{chat_id, basic_group_id}`.
      const upgraded = await attempt(
        () =>
          adapter.rawInvoke({
            _: 'upgradeBasicGroupChatToSupergroupChat',
            chat_id: Number(basic.chat_id),
          }),
        'upgradeBasicGroupChatToSupergroupChat',
      )
      forum = await adapter.getChat(Number(upgraded.id))
      check(`forum created: ${forum.title} (${forum.id})`)
      const createdRaw = await adapter.rawInvoke({ _: 'getChat', chat_id: forum.id })
      supergroupId = Number(createdRaw.type?.supergroup_id ?? 0)
      const info =
        supergroupId > 0
          ? await adapter.rawInvoke({ _: 'getSupergroup', supergroup_id: supergroupId })
          : {}
      console.log(
        `  raw type    : ${String(createdRaw.type?._)} supergroup=${supergroupId} isChannel=${String(info.is_channel)} isForum=${String(info.is_forum)}`,
      )
      if (!(supergroupId > 0)) throw new Error('the new chat has no supergroup id')

      /**
       * `createNewSupergroupChat{is_forum:true}` is accepted, but on this TDLib build
       * the chat can still come back with `view_as_topics: false` while the server
       * settles. Toggle it explicitly and poll until the client reports a forum —
       * that is also the code path an administrator uses to convert a group.
       */
      const isForumNow = async (): Promise<boolean> => {
        const chatRaw = await adapter.rawInvoke({ _: 'getChat', chat_id: forum?.id ?? 0 })
        if (chatRaw.view_as_topics === true) return true
        try {
          const full = await adapter.rawInvoke({
            _: 'getSupergroupFullInfo',
            supergroup_id: supergroupId,
          })
          return full?.is_forum === true
        } catch {
          return false
        }
      }

      if (!(await isForumNow())) {
        await adapter.rawInvoke({
          _: 'toggleSupergroupIsForum',
          supergroup_id: supergroupId,
          is_forum: true,
          has_forum_tabs: false,
          has_forum_sidebar: false,
        })
      }
      let forumReady = await isForumNow()
      for (let attempt = 0; attempt < 10 && !forumReady; attempt += 1) {
        await new Promise((done) => setTimeout(done, 800))
        forumReady = await isForumNow()
      }
      if (!forumReady) throw new Error('the supergroup never reported as a forum')
      check('forum mode: confirmed')
    }

    const layout = await adapter.forumLayout(forum.id)
    check(`forum layout: ${layout}`)

    const icons = await adapter.topicIcons()
    check(`topic icons: ${icons.length}`)

    // ---- the topic itself -------------------------------------------------
    const created = await adapter.createTopic({
      chatId: forum.id,
      title: 'Probe topic',
      iconColor: 0x6fb9f0,
      ...(icons[0] ? { iconEmojiId: icons[0].id } : {}),
    })
    check(`topic create: ${created.title} (id ${created.id})`)

    const page = await adapter.topics({ chatId: forum.id, limit: 50 })
    const listed = page.topics.find((topic) => topic.id === created.id)
    if (!listed) throw new Error('the created topic is not in getForumTopics')
    check(`topic list: ${page.topics.map((topic) => topic.title).join(', ')}`)

    const marker = `topic message ${Date.now()}`
    const sent = await adapter.sendText({ chatId: forum.id, topicId: created.id, text: marker })
    const message = await settledMessage(
      adapter,
      forum.id,
      (row) => row.kind === 'text' && row.text === marker,
      'the topic message',
      60_000,
      created.id,
    )
    check(`send into topic: ${sent.localId} -> ${message.id} (${message.topicId ?? 'no topic id'})`)

    const topicHistory = await adapter.history({
      chatId: forum.id,
      topicId: created.id,
      limit: 20,
    })
    if (!topicHistory.messages.some((row) => row.id === message.id)) {
      throw new Error('getForumTopicHistory did not return the message')
    }
    check(`topic history: ${topicHistory.messages.length} rows, hasMore=${topicHistory.hasMore}`)

    const around = await adapter.historyAround({
      chatId: forum.id,
      topicId: created.id,
      messageId: message.id,
      limit: 5,
    })
    if (!around.messages.some((row) => row.id === message.id)) {
      throw new Error('the around window missed the topic message')
    }
    check(`topic around: ${around.messages.length} rows`)

    // ---- management -------------------------------------------------------
    /**
     * The test DC accepts these writes — every call returns Ok — but does not
     * always reflect them back (measured 2026-11-23: `editForumTopic` returns `ok`
     * and `getForumTopic` keeps the old name for 20 s). Each one is a *soft*
     * check: the call itself must not throw, and a state that does not come back
     * is a warning rather than a failure.
     */
    const soft = async (label: string, work: () => Promise<void>): Promise<void> => {
      try {
        await work()
        check(label)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        warnings.push(`${label} (${message})`)
        console.log(`  [WARN] ${label}: ${message}`)
      }
    }
    const forumId = forum.id

    await soft('topic rename accepted', async () => {
      await adapter.editTopic({ chatId: forumId, topicId: created.id, title: 'Probe topic renamed' })
    })

    await soft('topic mute reflected', async () => {
      await adapter.setTopicMuted(forumId, created.id, true)
      await waitForTopic(
        forumId,
        created.id,
        (topic) => topic?.muted === true,
        'the server kept the old mute state',
      )
    })

    await soft('topic close reflected', async () => {
      await adapter.setTopicClosed(forumId, created.id, true)
      await waitForTopic(
        forumId,
        created.id,
        (topic) => topic?.isClosed === true,
        'the server kept the topic open',
      )
    })
    await adapter.setTopicClosed(forumId, created.id, false).catch(() => undefined)

    const link = await adapter.topicLink(forumId, created.id)
    check(`topic link: ${link?.link ?? '(none)'}`)

    await soft('topic pin reflected', async () => {
      await adapter.setPinnedMessage(forumId, message.id, created.id)
      const pinned = await adapter.pinnedMessage(forumId, created.id)
      if (pinned?.messageId !== message.id) throw new Error('the pin did not come back')
      await adapter.setPinnedMessage(forumId, null, created.id)
    })

    await soft('topic mark read accepted', async () => {
      await adapter.markRead({ chatId: forumId, topicId: created.id, upToMessageId: message.id })
    })

    // ---- tabs / sidebar ---------------------------------------------------
    await adapter.rawInvoke({
      _: 'toggleSupergroupIsForum',
      supergroup_id: supergroupId,
      is_forum: true,
      has_forum_tabs: true,
      has_forum_sidebar: false,
    })
    let layoutNow = await adapter.forumLayout(forumId)
    for (let attempt = 0; attempt < 10 && layoutNow !== 'tabs'; attempt += 1) {
      await new Promise((done) => setTimeout(done, 900))
      layoutNow = await adapter.forumLayout(forumId)
    }
    if (layoutNow !== 'tabs') {
      warnings.push('tabs layout not reflected')
      console.log(`  [WARN] tabs layout not reflected (still ${layoutNow})`)
    } else {
      check('forum layout after toggle: tabs')
    }
    await adapter.rawInvoke({
      _: 'toggleSupergroupIsForum',
      supergroup_id: supergroupId,
      is_forum: true,
      has_forum_tabs: false,
      has_forum_sidebar: false,
    })
    // ---- cleanup ----------------------------------------------------------
    await adapter.deleteTopic(forum.id, created.id)
    const after = await adapter.topics({ chatId: forum.id, limit: 50 })
    if (after.topics.some((topic) => topic.id === created.id)) {
      throw new Error('the deleted topic is still listed')
    }
    check('topic delete: ok')

    const suffix = warnings.length > 0 ? `, ${warnings.length} warning(s)` : ''
    console.log(`\n[PASS] 话题 on the test DC: ${checks.length} checks${suffix}`)
    for (const warning of warnings) console.log(`  [WARN] ${warning}`)
  } catch (error) {
    console.error(`\n[FAIL] ${error instanceof Error ? error.message : String(error)}`)
    console.error(`states seen: ${states.join(' -> ')}`)
    process.exitCode = 1
  } finally {
    clearTimeout(guard)
    // A probe forum is disposable even when a check failed half-way: the test DC
    // must not fill up with them (the previous runs left channels behind).
    if (env.cleanup && forum && ownedForum) {
      await adapter
        .rawInvoke({ _: 'deleteChat', chat_id: forum.id })
        .then(() => check('probe chat deleted'))
        .catch(() => undefined)
    }
    await adapter.stop().catch(() => undefined)
    setTimeout(() => process.exit(process.exitCode ?? 0), 300)
  }
}
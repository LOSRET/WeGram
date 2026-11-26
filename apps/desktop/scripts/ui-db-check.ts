/**
 * Headless check for `ui.db` (design doc §5.2).
 *
 * Runs under plain Node, so `node:sqlite` is exercised exactly as the main
 * process would use it — no Electron window needed.
 *
 *   cd apps\desktop
 *   pnpm ui:db-check
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { UiDatabase } from '../src/main/store/ui-db'

const dir = mkdtempSync(join(tmpdir(), 'wegram-ui-db-'))
const file = join(dir, 'ui.db')

let failures = 0
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(actual)}`)
}

try {
  const db = new UiDatabase(file)
  db.open()

  check('journal mode', db.getJournalMode(), 'delete')
  check('empty draft', db.getDraft(42), null)
  db.saveDraft(42, { text: '草稿内容', replyTo: 7 })
  check('draft roundtrip', db.getDraft(42), { text: '草稿内容', replyTo: 7 })

  db.saveDraft(42, null)
  check('draft cleared', db.getDraft(42), null)

  check('empty setting', db.getSetting('theme'), null)
  db.setSetting('theme', 'dark')
  check('setting roundtrip', db.getSetting('theme'), 'dark')

  db.saveScrollAnchor(42, 12345, 12)
  check('scroll anchor', db.getScrollAnchor(42), { messageId: 12345, offset: 12 })

  check('no comment anchor yet', db.getCommentAnchor(42, 900), null)
  db.saveCommentAnchor(42, 900, 4711, -8)
  check('comment anchor', db.getCommentAnchor(42, 900), { messageId: 4711, offset: -8 })
  check('another thread is untouched', db.getCommentAnchor(42, 901), null)
  check('the chat anchor is untouched', db.getScrollAnchor(42), { messageId: 12345, offset: 12 })

  db.close()

  // Reopen: everything must survive a restart.
  const reopened = new UiDatabase(file)
  reopened.open()
  check('setting after reopen', reopened.getSetting('theme'), 'dark')
  check('anchor after reopen', reopened.getScrollAnchor(42), { messageId: 12345, offset: 12 })
  check('comment anchor after reopen', reopened.getCommentAnchor(42, 900), {
    messageId: 4711,
    offset: -8,
  })
  reopened.close()
} finally {
  rmSync(dir, { recursive: true, force: true })
}

console.log(failures === 0 ? '\n[PASS] ui.db check passed' : `\n[FAIL] ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { createLogger } from '../util'

export interface DraftRecord {
  text: string
  replyTo?: number
}

export interface MiniAppBiometryRecord {
  accessRequested: boolean
  accessGranted: boolean
  tokenSealed: string | null
}

const logger = createLogger('ui-db')

/** `app_settings` key of the 图片和视频 window's level (design doc §9.5). */
const VIEWER_VOLUME_KEY = 'viewer_volume'

/** SQLite's primary result code; extended codes (`8 + n * 256`) keep the low byte. */
const SQLITE_READONLY = 8

/**
 * Did a write fail because this connection is read-only?
 *
 * SQLite opens an unwritable database file without erroring, then answers every
 * write with this. The user-visible text is `attempt to write a readonly
 * database`; `errcode` (when node:sqlite provides it) also names extended causes
 * such as `SQLITE_READONLY_DBMOVED` (1032) and `SQLITE_READONLY_DIRECTORY` (1544).
 */
function isReadonlyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if (
    'errcode' in error &&
    typeof error.errcode === 'number' &&
    (error.errcode & 0xff) === SQLITE_READONLY
  ) {
    return true
  }
  return 'message' in error && typeof error.message === 'string'
    ? error.message.includes('readonly database')
    : false
}

/**
 * UI database (`ui.db`, design doc §5.1/§5.2).
 *
 * Uses the built-in `node:sqlite` instead of better-sqlite3: it ships with
 * Electron's Node (24.22) so there is no native module to rebuild for the
 * Electron ABI. It is flagged experimental upstream, so the schema access is
 * confined to this file — swapping in better-sqlite3 later touches nothing else.
 *
 * Message data is NOT stored here: TDLib owns it (§5.1).
 */
const SCHEMA = `
-- DELETE, not WAL, on purpose. WAL keeps a persistent -wal/-shm pair next to
-- ui.db; a higher-integrity process (an elevated dev shell, a backup tool, a
-- packaged app) can create those at Medium while Electron runs at Low, and then
-- SQLite opens this database read-only for good. The rollback journal exists only
-- for the write and is created by the writer itself, so there is no sidecar to go
-- stale across launches. One connection writes this store, and its writes are tiny.
PRAGMA journal_mode = DELETE;

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY,
  phone         TEXT,
  first_name    TEXT,
  last_name     TEXT,
  username      TEXT,
  is_active     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_ui_state (
  chat_id          INTEGER PRIMARY KEY,
  draft_text       TEXT,
  draft_entities   TEXT,
  draft_reply_to   INTEGER,
  scroll_anchor_id INTEGER,
  scroll_offset    INTEGER,
  last_painted_at  INTEGER
);

-- One reading position per comment thread (§9.8). The key is the *commented*
-- message, because a chat's own anchor must stay untouched, and one channel can
-- hold many open threads. Missing row = the reader never scrolled: the panel
-- opens at the top of the thread.
CREATE TABLE IF NOT EXISTS comment_ui_state (
  chat_id          INTEGER NOT NULL,
  message_id       INTEGER NOT NULL,
  anchor_id        INTEGER NOT NULL,
  anchor_offset    INTEGER NOT NULL DEFAULT 0,
  last_painted_at  INTEGER NOT NULL,
  PRIMARY KEY (chat_id, message_id)
);

-- 话题 (design doc §9.12): one draft and one reading position per topic, the
-- same shape as chat_ui_state. A forum never uses the chat row, and a chat
-- converted to a forum keeps it for the flat "view as chats" mode. A separate
-- table rather than an extra column, because SQLite cannot widen a primary key
-- in place.
CREATE TABLE IF NOT EXISTS topic_ui_state (
  chat_id          INTEGER NOT NULL,
  topic_id         INTEGER NOT NULL,
  draft_text       TEXT,
  draft_reply_to   INTEGER,
  scroll_anchor_id INTEGER,
  scroll_offset    INTEGER,
  last_painted_at  INTEGER,
  PRIMARY KEY (chat_id, topic_id)
);

CREATE TABLE IF NOT EXISTS app_settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- Mini App biometric consent and the DPAPI-sealed token, isolated by the
-- signed-in user and bot. The raw token never reaches this database.
CREATE TABLE IF NOT EXISTS miniapp_biometry (
  user_id          INTEGER NOT NULL,
  bot_user_id      INTEGER NOT NULL,
  access_requested INTEGER NOT NULL DEFAULT 0,
  access_granted   INTEGER NOT NULL DEFAULT 0,
  token_sealed     TEXT,
  PRIMARY KEY (user_id, bot_user_id)
);

CREATE TABLE IF NOT EXISTS media_cache (
  file_id      INTEGER PRIMARY KEY,
  remote_id    TEXT UNIQUE,
  local_path   TEXT,
  size         INTEGER,
  last_used_at INTEGER,
  pinned       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_media_lru ON media_cache(pinned, last_used_at);
`

export class UiDatabase {
  private db: DatabaseSync | null = null

  constructor(private readonly file: string) {}

  open(): void {
    if (this.db) return
    this.db = this.connect()
    logger.info(`opened ${this.file}`)
  }

  close(): void {
    this.db?.close()
    this.db = null
  }

  private connect(): DatabaseSync {
    mkdirSync(dirname(this.file), { recursive: true })
    // The default busy timeout is 0: a lock held by another handle failed
    // immediately instead of waiting the few milliseconds it needed. Five seconds
    // is the usual SQLite default for a single-owner file.
    const db = new DatabaseSync(this.file, { timeout: 5_000 })
    try {
      db.exec(SCHEMA)
    } catch (error) {
      // A store already stuck in WAL with sidecars this process cannot write can
      // still be read; its writes already fail with the clear SQLITE_READONLY
      // error. Do not turn that degraded state into a startup crash.
      if (!isReadonlyError(error)) throw error
      logger.warn('ui.db answered readonly during setup; continuing read-only')
    }
    return db
  }

  /**
   * Runs one write, reopening once if SQLite answers `SQLITE_READONLY`.
   *
   * When the OS refuses a write-open (another process's share mode, or a file
   * created at a higher integrity level than this process), SQLite opens the
   * database read-only without an error: reads keep working and only writes
   * answer `attempt to write a readonly database` — exactly what the settings
   * window showed on 2026-11-26. A fresh connection after the holder is gone is
   * writable; if it is not, the retry's error is the one the caller sees.
   *
   * The journal mode is DELETE for the same reason (see SCHEMA): WAL's persistent
   * `-wal`/`-shm` sidecars are a second place for that integrity mismatch to live,
   * and a Low-integrity Electron cannot remove sidecars a higher-integrity process
   * left behind.
   */
  private write(run: (db: DatabaseSync) => void): void {
    try {
      run(this.require())
    } catch (error) {
      if (!isReadonlyError(error)) throw error
      logger.warn('ui.db is read-only; reopening and retrying the write')
      this.reconnect()
      run(this.require())
    }
  }

  private reconnect(): void {
    const previous = this.db
    // Open the replacement before dropping the old handle: if the file is still
    // locked, the current reader stays usable instead of leaving the app with no
    // open database at all.
    const next = this.connect()
    this.db = next
    if (!previous) return
    try {
      previous.close()
    } catch (error) {
      logger.warn(`old ui.db handle did not close: ${String(error)}`)
    }
  }

  getDraft(chatId: number): DraftRecord | null {
    const row = this.require()
      .prepare('SELECT draft_text, draft_reply_to FROM chat_ui_state WHERE chat_id = ?')
      .get(chatId) as { draft_text: string | null; draft_reply_to: number | null } | undefined

    if (!row?.draft_text) return null
    return {
      text: row.draft_text,
      ...(row.draft_reply_to == null ? {} : { replyTo: Number(row.draft_reply_to) }),
    }
  }

  saveDraft(chatId: number, draft: DraftRecord | null): void {
    this.write((db) => {
      if (!draft || draft.text.trim().length === 0) {
        db.prepare(
          `INSERT INTO chat_ui_state (chat_id, draft_text, draft_reply_to, last_painted_at)
           VALUES (?, NULL, NULL, ?)
           ON CONFLICT(chat_id) DO UPDATE SET draft_text = NULL, draft_reply_to = NULL, last_painted_at = excluded.last_painted_at`,
        ).run(chatId, Date.now())
        return
      }

      db.prepare(
        `INSERT INTO chat_ui_state (chat_id, draft_text, draft_reply_to, last_painted_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           draft_text = excluded.draft_text,
           draft_reply_to = excluded.draft_reply_to,
           last_painted_at = excluded.last_painted_at`,
      ).run(chatId, draft.text, draft.replyTo ?? null, Date.now())
    })
  }

  /** 话题内草稿: the same record as a chat's, keyed by (chat, topic). */
  getTopicDraft(chatId: number, topicId: number): DraftRecord | null {
    const row = this.require()
      .prepare(
        'SELECT draft_text, draft_reply_to FROM topic_ui_state WHERE chat_id = ? AND topic_id = ?',
      )
      .get(chatId, topicId) as
      { draft_text: string | null; draft_reply_to: number | null } | undefined

    if (!row?.draft_text) return null
    return {
      text: row.draft_text,
      ...(row.draft_reply_to == null ? {} : { replyTo: Number(row.draft_reply_to) }),
    }
  }

  saveTopicDraft(chatId: number, topicId: number, draft: DraftRecord | null): void {
    this.write((db) => {
      if (!draft || draft.text.trim().length === 0) {
        db.prepare(
          `INSERT INTO topic_ui_state (chat_id, topic_id, draft_text, draft_reply_to, last_painted_at)
           VALUES (?, ?, NULL, NULL, ?)
           ON CONFLICT(chat_id, topic_id) DO UPDATE SET
             draft_text = NULL, draft_reply_to = NULL, last_painted_at = excluded.last_painted_at`,
        ).run(chatId, topicId, Date.now())
        return
      }

      db.prepare(
        `INSERT INTO topic_ui_state (chat_id, topic_id, draft_text, draft_reply_to, last_painted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, topic_id) DO UPDATE SET
           draft_text = excluded.draft_text,
           draft_reply_to = excluded.draft_reply_to,
           last_painted_at = excluded.last_painted_at`,
      ).run(chatId, topicId, draft.text, draft.replyTo ?? null, Date.now())
    })
  }

  /** 话题内阅读位置; `messageId: null` means "the reader was at the bottom". */
  saveTopicAnchor(chatId: number, topicId: number, messageId: number | null, offset = 0): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO topic_ui_state (chat_id, topic_id, scroll_anchor_id, scroll_offset, last_painted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, topic_id) DO UPDATE SET
           scroll_anchor_id = excluded.scroll_anchor_id,
           scroll_offset = excluded.scroll_offset,
           last_painted_at = excluded.last_painted_at`,
      ).run(chatId, topicId, messageId, offset, Date.now())
    })
  }

  getTopicAnchor(chatId: number, topicId: number): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare(
        'SELECT scroll_anchor_id, scroll_offset FROM topic_ui_state WHERE chat_id = ? AND topic_id = ?',
      )
      .get(chatId, topicId) as
      { scroll_anchor_id: number | null; scroll_offset: number | null } | undefined
    if (row?.scroll_anchor_id == null) return null
    return { messageId: Number(row.scroll_anchor_id), offset: Number(row.scroll_offset ?? 0) }
  }

  getSetting(key: string): string | null {
    const row = this.require().prepare('SELECT v FROM app_settings WHERE k = ?').get(key) as
      { v: string } | undefined
    return row?.v ?? null
  }

  /** The journal mode in force; the schema asks for DELETE (see SCHEMA). */
  getJournalMode(): string {
    const row = this.require().prepare('PRAGMA journal_mode').get() as
      { journal_mode: string } | undefined
    return row?.journal_mode ?? ''
  }

  setSetting(key: string, value: string): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO app_settings (k, v) VALUES (?, ?)
         ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      ).run(key, value)
    })
  }

  getMiniAppBiometry(userId: number, botUserId: number): MiniAppBiometryRecord {
    const row = this.require()
      .prepare(
        `SELECT access_requested, access_granted, token_sealed
         FROM miniapp_biometry WHERE user_id = ? AND bot_user_id = ?`,
      )
      .get(userId, botUserId) as
      { access_requested: number; access_granted: number; token_sealed: string | null } | undefined
    return {
      accessRequested: row?.access_requested === 1,
      accessGranted: row?.access_granted === 1,
      tokenSealed: row?.token_sealed ?? null,
    }
  }

  setMiniAppBiometryAccess(
    userId: number,
    botUserId: number,
    access: { requested: boolean; granted: boolean },
  ): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO miniapp_biometry (user_id, bot_user_id, access_requested, access_granted)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, bot_user_id) DO UPDATE SET
           access_requested = excluded.access_requested,
           access_granted = excluded.access_granted`,
      ).run(userId, botUserId, access.requested ? 1 : 0, access.granted ? 1 : 0)
    })
  }

  /** `tokenSealed: null` removes the token; callers seal before writing. */
  setMiniAppBiometryToken(userId: number, botUserId: number, tokenSealed: string | null): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO miniapp_biometry (user_id, bot_user_id, token_sealed)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id, bot_user_id) DO UPDATE SET token_sealed = excluded.token_sealed`,
      ).run(userId, botUserId, tokenSealed)
    })
  }

  /**
   * The 图片和视频 window's volume (§9.5): one level for the whole app, so a clip
   * opened later starts where the last one was left. `null` means "never saved" and
   * the player reads it as full volume, which is also the answer to a broken row —
   * a lost setting must never open a clip silent.
   */
  getViewerVolume(): number | null {
    const stored = this.getSetting(VIEWER_VOLUME_KEY)
    if (stored === null || stored.trim().length === 0) return null
    const volume = Number(stored)
    return Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : null
  }

  setViewerVolume(volume: number): void {
    if (!Number.isFinite(volume)) return
    this.setSetting(VIEWER_VOLUME_KEY, String(Math.min(1, Math.max(0, volume))))
  }

  /**
   * Reading position of a chat (§8.2 rule 5). Written by MessageList after the
   * reader scrolls, read back by ChatPane when the chat is opened.
   *
   * `messageId: null` is meaningful: it means "the reader was at the bottom" and
   * is what makes reopening the chat land on the newest message.
   */
  saveScrollAnchor(chatId: number, messageId: number | null, offset = 0): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO chat_ui_state (chat_id, scroll_anchor_id, scroll_offset, last_painted_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET
           scroll_anchor_id = excluded.scroll_anchor_id,
           scroll_offset = excluded.scroll_offset,
           last_painted_at = excluded.last_painted_at`,
      ).run(chatId, messageId, offset, Date.now())
    })
  }

  /**
   * Reading position inside one message's comment thread (§9.8). Keyed by the
   * commented message: the same chat can have many threads, and a channel's own
   * scroll position is a different row in `chat_ui_state`.
   *
   * No row at all is the default: the discussion view opens at its top.
   */
  saveCommentAnchor(chatId: number, messageId: number, anchorId: number, offset = 0): void {
    this.write((db) => {
      db.prepare(
        `INSERT INTO comment_ui_state (chat_id, message_id, anchor_id, anchor_offset, last_painted_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(chat_id, message_id) DO UPDATE SET
           anchor_id = excluded.anchor_id,
           anchor_offset = excluded.anchor_offset,
           last_painted_at = excluded.last_painted_at`,
      ).run(chatId, messageId, anchorId, offset, Date.now())
    })
  }

  getCommentAnchor(
    chatId: number,
    messageId: number,
  ): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare(
        'SELECT anchor_id, anchor_offset FROM comment_ui_state WHERE chat_id = ? AND message_id = ?',
      )
      .get(chatId, messageId) as { anchor_id: number; anchor_offset: number | null } | undefined
    if (row == null) return null
    return { messageId: Number(row.anchor_id), offset: Number(row.anchor_offset ?? 0) }
  }

  getScrollAnchor(chatId: number): { messageId: number; offset: number } | null {
    const row = this.require()
      .prepare('SELECT scroll_anchor_id, scroll_offset FROM chat_ui_state WHERE chat_id = ?')
      .get(chatId) as { scroll_anchor_id: number | null; scroll_offset: number | null } | undefined
    if (row?.scroll_anchor_id == null) return null
    return { messageId: Number(row.scroll_anchor_id), offset: Number(row.scroll_offset ?? 0) }
  }

  private require(): DatabaseSync {
    if (!this.db) throw new Error('ui.db is not open')
    return this.db
  }
}
